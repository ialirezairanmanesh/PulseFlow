import 'package:flutter/foundation.dart';
import 'package:flutter/painting.dart';

/// Default overhead (decoded minus displayed bytes) before an image is flagged.
const int defaultImageOverheadBytes = 256 * 1024;

/// Whether an image is decoded much larger than it is displayed.
bool isOversizedImage(
  int decodedBytes,
  int displayBytes, {
  int thresholdBytes = defaultImageOverheadBytes,
}) {
  return decodedBytes - displayBytes >= thresholdBytes;
}

class _ImageEntry {
  _ImageEntry({required this.source});

  final String source;
  int count = 0;
  int decodedBytes = 0;
  int displayBytes = 0;

  int get overheadBytes => decodedBytes - displayBytes;

  Map<String, Object?> toJson() => <String, Object?>{
        'source': source,
        'decodedBytes': decodedBytes,
        'displayBytes': displayBytes,
        'overheadBytes': overheadBytes,
        'count': count,
      };
}

/// Tracks oversized image decodes via [debugOnPaintImage] and reports image
/// cache health. Debug/profile only.
class ImageProbe {
  ImageProbe._();

  static final ImageProbe instance = ImageProbe._();

  bool _active = false;
  PaintImageCallback? _previous;
  final Map<String, _ImageEntry> _oversized = <String, _ImageEntry>{};
  int thresholdBytes = defaultImageOverheadBytes;

  bool get active => _active;

  void start() {
    if (_active) return;
    if (kReleaseMode) return;
    _active = true;
    _previous = debugOnPaintImage;
    debugOnPaintImage = _onPaint;
  }

  void stop() {
    if (!_active) return;
    _active = false;
    debugOnPaintImage = _previous;
    _previous = null;
  }

  void reset() {
    _oversized.clear();
  }

  void _onPaint(ImageSizeInfo info) {
    _previous?.call(info);
    final int decoded = info.decodedSizeInBytes;
    final int display = info.displaySizeInBytes;
    if (!isOversizedImage(decoded, display, thresholdBytes: thresholdBytes)) return;
    final String source = info.source ?? 'unknown';
    final _ImageEntry entry =
        _oversized.putIfAbsent(source, () => _ImageEntry(source: source));
    entry.count += 1;
    if (decoded > entry.decodedBytes) {
      entry.decodedBytes = decoded;
      entry.displayBytes = display;
    }
    while (_oversized.length > 40) {
      _oversized.remove(_oversized.keys.first);
    }
  }

  Map<String, Object?> snapshot({int limit = 30}) {
    if (kReleaseMode) {
      return <String, Object?>{
        'ok': true,
        'available': false,
        'message': 'Image tracking is only available in debug/profile builds',
      };
    }
    final ImageCache cache = PaintingBinding.instance.imageCache;
    final List<_ImageEntry> oversized = _oversized.values.toList()
      ..sort((_ImageEntry a, _ImageEntry b) => b.overheadBytes.compareTo(a.overheadBytes));
    return <String, Object?>{
      'ok': true,
      'available': true,
      'active': _active,
      'cache': <String, Object?>{
        'currentSizeBytes': cache.currentSizeBytes,
        'currentSize': cache.currentSize,
        'maximumSizeBytes': cache.maximumSizeBytes,
        'live': cache.liveImageCount,
        'pending': cache.pendingImageCount,
      },
      'oversized': oversized.take(limit).map((_ImageEntry e) => e.toJson()).toList(),
    };
  }
}
