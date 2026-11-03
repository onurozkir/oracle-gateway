// A tiny Windows process owner. Start suspended, assign to a kill-on-close job,
// then resume. No candidate process runs before the job owns its descendants.
using System;
using System.Text;
using System.Runtime.InteropServices;

class OracleGateJobHost {
  const int HostError = 0x5A170001;
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong a,b,c,d,e,f; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long processTime, jobTime; public uint flags;
    public UIntPtr minWorkingSet, maxWorkingSet; public uint activeProcesses;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits basic; public IO io;
    public UIntPtr processMemory, jobMemory, peakProcessMemory, peakJobMemory;
  }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public uint cb; public string reserved, desktop, title;
    public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
    public ushort show, reservedCount; public IntPtr reservedBytes, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process, thread; public uint pid, tid; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll")] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  static string Quote(string value) {
    var b = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { b.Append('\\', slashes * 2 + 1); b.Append(c); }
      else { b.Append('\\', slashes); b.Append(c); }
      slashes = 0;
    }
    b.Append('\\', slashes * 2); b.Append('"'); return b.ToString();
  }
  static int Main(string[] args) {
    if (args.Length == 0) return HostError;
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    var info = new ProcessInfo(); bool started = false;
    try {
      if (job == IntPtr.Zero) return HostError;
      var limits = new ExtendedLimits(); limits.basic.flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits)))) return HostError;
      var startup = new Startup(); startup.cb = (uint)Marshal.SizeOf(typeof(Startup));
      startup.flags = 0x100; startup.input = GetStdHandle(-10); startup.output = GetStdHandle(-11); startup.error = GetStdHandle(-12);
      var command = new StringBuilder();
      foreach (string arg in args) { if (command.Length > 0) command.Append(' '); command.Append(Quote(arg)); }
      if (!CreateProcess(null, command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, null, ref startup, out info)) return HostError;
      started = true;
      if (!AssignProcessToJobObject(job, info.process)) { TerminateProcess(info.process, HostError); return HostError; }
      if (ResumeThread(info.thread) == UInt32.MaxValue) return HostError;
      if (WaitForSingleObject(info.process, UInt32.MaxValue) != 0) return HostError;
      uint exitCode;
      if (!GetExitCodeProcess(info.process, out exitCode)) return HostError;
      // Parent exited. Remove every remaining descendant before returning its code.
      TerminateJobObject(job, 1);
      return unchecked((int)exitCode);
    } finally {
      if (job != IntPtr.Zero) { TerminateJobObject(job, 1); CloseHandle(job); }
      if (started) { CloseHandle(info.thread); CloseHandle(info.process); }
    }
  }
}
