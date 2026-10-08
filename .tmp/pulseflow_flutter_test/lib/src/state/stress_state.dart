/// Holds demo/stress state an app can listen to (for example with a
/// [ValueNotifier]) while PulseFlow scenarios inject work.
class PulseFlowStressState {
  PulseFlowStressState._();

  static final PulseFlowStressState instance = PulseFlowStressState._();

  /// App-supplied invoices appended by `injectInvoices` / `listFlood`.
  final List<Map<String, dynamic>> invoices = <Map<String, dynamic>>[];

  /// Byte buffers retained by `allocateMemory` / `retainMemory`.
  final List<List<int>> retainedBuffers = <List<int>>[];

  /// Optional app hook used by the `networkBurst` scenario.
  Future<void> Function(Map<String, String> params)? onNetworkBurst;
}
