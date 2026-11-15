using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Oclr.WinUI;

internal static class Program
{
    [DllImport("Microsoft.ui.xaml.dll")]
    private static extern void XamlCheckProcessRequirements();

    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] is "--headless" or "--smoke-test")
            return ForwardAsync(args[0]).GetAwaiter().GetResult();

        XamlCheckProcessRequirements();
        WinRT.ComWrappersSupport.InitializeComWrappers();
        Application.Start(_ =>
        {
            var dispatcher = DispatcherQueue.GetForCurrentThread();
            SynchronizationContext.SetSynchronizationContext(new DispatcherQueueSynchronizationContext(dispatcher));
            new App();
        });
        return 0;
    }

    private static async Task<int> ForwardAsync(string mode)
    {
        using var child = Process.Start(LauncherBridge.CoreStartInfo(mode))!;
        var stderr = child.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
        var exit = child.WaitForExitAsync();
        var stdin = Console.OpenStandardInput().CopyToAsync(child.StandardInput.BaseStream);
        if (await Task.WhenAny(exit, stdin) == stdin)
        {
            try { await stdin; }
            catch (IOException) { }
            child.StandardInput.Close();
        }
        await exit;
        await stderr;
        return child.ExitCode;
    }
}
