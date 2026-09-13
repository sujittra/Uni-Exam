importScripts("https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js");

let pyodideReadyPromise = loadPyodide();

self.onmessage = async (event) => {
  const { id, code, stdin } = event.data;
  try {
    const pyodide = await pyodideReadyPromise;
    pyodide.globals.set('_stdin_data', stdin || '');
    pyodide.globals.set('_user_code', code || '');
    const result = pyodide.runPython(`
import sys, io, builtins, traceback

class _ListInput:
    def __init__(self, data):
        self._lines = iter(data.split(chr(10)))
    def __call__(self, prompt=''):
        try:
            return next(self._lines)
        except StopIteration:
            return ''

builtins.input = _ListInput(_stdin_data)
_stdout = io.StringIO()
_stderr = io.StringIO()
_old_stdout, _old_stderr = sys.stdout, sys.stderr
sys.stdout, sys.stderr = _stdout, _stderr
_error = None
try:
    exec(_user_code, {'__name__': '__main__'})
except SystemExit:
    pass
except Exception:
    _error = traceback.format_exc()
sys.stdout, sys.stderr = _old_stdout, _old_stderr
[_stdout.getvalue(), _stderr.getvalue(), _error]
`);
    const [stdout, stderr, error] = result.toJs();
    result.destroy();
    postMessage({ id, success: true, stdout, stderr, error });
  } catch (e) {
    postMessage({ id, success: false, error: String((e && e.message) || e) });
  }
};
