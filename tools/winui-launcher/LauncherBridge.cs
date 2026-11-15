using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace Oclr.WinUI;

internal sealed class LauncherBridge : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim gate = new(1);
    private readonly Process child = Process.Start(CoreStartInfo("--winui-host"))!;
    private bool disposed;

    internal static ProcessStartInfo CoreStartInfo(string mode) => new(Path.Combine(AppContext.BaseDirectory, "OCLR-core.exe"))
    {
        ArgumentList = { mode },
        WorkingDirectory = AppContext.BaseDirectory,
        UseShellExecute = false,
        CreateNoWindow = true,
        RedirectStandardInput = true,
        RedirectStandardOutput = mode == "--winui-host",
        RedirectStandardError = mode != "--winui-host",
        StandardInputEncoding = new UTF8Encoding(false),
        StandardOutputEncoding = mode == "--winui-host" ? new UTF8Encoding(false) : null,
    };

    internal async Task<LauncherState> RequestAsync(string action, string value = "")
    {
        await gate.WaitAsync();
        try
        {
            ObjectDisposedException.ThrowIf(disposed, this);
            await child.StandardInput.WriteLineAsync(JsonSerializer.Serialize(new { action, value }, JsonOptions));
            await child.StandardInput.FlushAsync();
            var line = await child.StandardOutput.ReadLineAsync();
            return line is null
                ? throw new IOException("本机启动服务已停止。")
                : JsonSerializer.Deserialize<LauncherState>(line, JsonOptions)
                    ?? throw new IOException("无法读取本机启动服务状态。");
        }
        finally { gate.Release(); }
    }

    public void Dispose()
    {
        if (disposed) return;
        disposed = true;
        child.StandardInput.Close();
        child.Dispose();
    }
}

internal sealed record LauncherState(
    string Status, string Detail, string Base, string Port, string Build,
    string TosuPath, string TosuProcess, string TosuPort, string OsuPath, bool OsuValid,
    string LogPath, string Log);
