import 'package:vm_service/vm_service.dart';
import 'package:vm_service/vm_service_io.dart';

Future<void> main(List<String> args) async {
  final candidates = args.isNotEmpty
      ? args
      : <String>[
          'ws://127.0.0.1:33389/KWmRfrgWH_A=/ws',
          'ws://127.0.0.1:39725/htPYYFEndZc=/ws',
          'ws://127.0.0.1:38757/ZBZ9SKJ30GE=/ws',
        ];

  for (final url in candidates) {
    print('--- trying $url');
    try {
      final VmService vm =
          await vmServiceConnectUri(url).timeout(const Duration(seconds: 4));
      final VM info = await vm.getVM();
      print('VM: ${info.name} version=${info.version}');
      final IsolateRef? iso = info.isolates
              ?.where((IsolateRef i) => i.isSystemIsolate != true)
              .firstOrNull ??
          info.isolates?.firstOrNull;
      print('isolate: ${iso?.name} ${iso?.id}');

      try {
        final FlagList flags = await vm.getFlagList();
        final Flag? p =
            flags.flags?.where((Flag f) => f.name == 'profiler').firstOrNull;
        print('profiler flag: ${p?.valueAsString} (exists=${p != null})');
      } catch (e) {
        print('getFlagList error: $e');
      }

      try {
        await vm.setFlag('profiler', 'true');
        print('setFlag profiler=true OK');
      } catch (e) {
        print('setFlag error: $e');
      }

      if (iso?.id == null) {
        print('no isolate');
        await vm.dispose();
        continue;
      }

      try {
        final CpuSamples samples = await vm.getCpuSamples(iso!.id!, 0, 1);
        print(
          'getCpuSamples OK sampleCount=${samples.sampleCount} '
          'functions=${samples.functions?.length}',
        );
      } catch (e) {
        print('getCpuSamples typed error: $e');
      }

      try {
        final Response r = await vm.callServiceExtension(
          'getCpuSamples',
          isolateId: iso!.id,
          args: <String, dynamic>{
            'timeOriginMicros': 0,
            'timeExtentMicros': 1,
          },
        );
        print('callServiceExtension getCpuSamples OK type=${r.type}');
      } catch (e) {
        print('callServiceExtension getCpuSamples error: $e');
      }

      await vm.dispose();
    } catch (e) {
      print('connect fail: $e');
    }
  }
}
