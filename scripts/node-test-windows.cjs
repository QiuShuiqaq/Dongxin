// The sandboxed Windows account cannot answer os.userInfo(), which tsx uses
// only to name its temporary directory. This shim is test-process only.
if (process.platform === 'win32' && !process.geteuid) {
  process.geteuid = () => 0;
}
