using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using System.Diagnostics;
using System.Runtime.InteropServices;
using Windows.ApplicationModel.DataTransfer;
using Windows.Storage.Pickers;
using WinRT.Interop;

namespace Oclr.WinUI;

public sealed partial class LauncherWindow : Window
{
    private LauncherBridge? bridge;
    private LauncherState? state;
    private readonly DispatcherQueueTimer timer;
    private bool busy;
    private bool polling;
    private bool confirming;
    private bool canClose;

    [DllImport("user32.dll")]
    private static extern uint GetDpiForWindow(nint window);

    public LauncherWindow()
    {
        InitializeComponent();
        var scale = GetDpiForWindow(WindowNative.GetWindowHandle(this)) / 96.0;
        AppWindow.ResizeClient(new Windows.Graphics.SizeInt32((int)(820 * scale), (int)(570 * scale)));
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "oclr-stream.ico"));
        Sidebar.SelectedItem = OverviewItem;
        timer = DispatcherQueue.CreateTimer();
        timer.Interval = TimeSpan.FromSeconds(2);
        timer.Tick += async (_, _) => await RefreshAsync();
        Root.Loaded += Start;
        AppWindow.Closing += (sender, args) =>
        {
            if (canClose) return;
            args.Cancel = true;
            _ = ExitAsync();
        };
        Closed += (_, _) =>
        {
            timer.Stop();
            bridge?.Dispose();
        };
        UpdateButtons();
    }

    private async void Start(object sender, RoutedEventArgs args)
    {
        Root.Loaded -= Start;
        try
        {
            bridge = new LauncherBridge();
            await RunAsync("start");
            if (state?.Status == "reused")
            {
                OpenTarget(state.Base + "/control");
                canClose = true;
                Close();
                return;
            }
            if (state?.Status == "ready") OpenTarget(state.Base + "/control");
            timer.Start();
        }
        catch (Exception ex) when (ex is IOException or System.ComponentModel.Win32Exception)
        {
            ShowError("无法运行随包附带的服务。请确认已完整解压。");
        }
    }

    private void SelectPage(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem { Tag: string page }) return;
        Overview.Visibility = page == "overview" ? Visibility.Visible : Visibility.Collapsed;
        Settings.Visibility = page == "settings" ? Visibility.Visible : Visibility.Collapsed;
        Logs.Visibility = page == "logs" ? Visibility.Visible : Visibility.Collapsed;
        About.Visibility = page == "about" ? Visibility.Visible : Visibility.Collapsed;
        if (page == "logs" && bridge is not null) _ = RefreshAsync();
    }

    private async Task RefreshAsync()
    {
        if (bridge is null || busy || polling || canClose) return;
        polling = true;
        try
        {
            var logs = Logs.Visibility == Visibility.Visible;
            var reply = await bridge.RequestAsync(logs ? "logs" : "status");
            Apply(reply);
            if (logs && LogPreview.FocusState == FocusState.Unfocused)
            {
                var content = string.IsNullOrEmpty(reply.Log) ? "暂无日志记录。" : reply.Log;
                if (LogPreview.Text != content)
                {
                    LogPreview.Text = content;
                    LogPreview.Select(content.Length, 0);
                }
            }
        }
        catch (IOException ex) { ShowError(ex.Message); }
        finally { polling = false; }
    }

    private async Task RunAsync(string action, string value = "")
    {
        if (bridge is null || busy) return;
        busy = true;
        UpdateButtons();
        try
        {
            var reply = await bridge.RequestAsync(action, value);
            if (state is null || action == "restart")
                PortBox.Text = reply.Port;
            Apply(reply);
            var message = action == "restart" && reply.Status == "ready" && string.IsNullOrEmpty(reply.Detail)
                ? "直播服务已重新启动。" : reply.Detail;
            Feedback.Text = SettingsFeedback.Text = message;
        }
        catch (IOException ex) { ShowError(ex.Message); }
        finally { busy = false; UpdateButtons(); }
    }

    private void Apply(LauncherState reply)
    {
        state = reply;
        ServiceStatus.Text = reply.Status switch
        {
            "ready" => "● 服务已就绪",
            "waiting" => "● 等待服务响应",
            "stopped" => "● 服务已停止",
            "failed" => "● 服务启动失败",
            _ => "正在准备本机服务…",
        };
        ObsAddress.Text = string.IsNullOrEmpty(reply.Base) ? "" : reply.Base + "/overlay";
        TosuPath.Text = reply.TosuPath;
        OsuPath.Text = reply.OsuPath;
        TosuState.Text = reply.TosuProcess + "\n" + reply.TosuPort;
        TourneyState.Text = reply.OsuValid ? "已选择 osu!.exe\n请在控制台连接授权赛季" : "到「设置」选择 osu!.exe";
        LogPath.Text = reply.LogPath;
        BuildLabel.Text = "构建标识  " + (string.IsNullOrEmpty(reply.Build) ? "开发构建" : reply.Build[..Math.Min(12, reply.Build.Length)]);
        UpdateButtons();
    }

    private void ShowError(string text)
    {
        ServiceStatus.Text = "● 启动服务不可用";
        Feedback.Text = SettingsFeedback.Text = text;
        state = null;
        UpdateButtons();
        timer.Stop();
    }

    private void UpdateButtons()
    {
        var ready = !busy && state?.Status == "ready";
        ConsoleButton.IsEnabled = CopyObsButton.IsEnabled = ready;
        RestartButton.IsEnabled = !busy && bridge is not null;
        TosuButton.IsEnabled = !busy && state?.TosuProcess == "未运行";
        GenerateButton.IsEnabled = TourneyButton.IsEnabled = ready && state!.OsuValid;
    }

    private async void PickExecutable(object sender, RoutedEventArgs args)
    {
        if (busy || bridge is null || sender is not Button { Tag: string action }) return;
        var picker = new FileOpenPicker();
        picker.FileTypeFilter.Add(".exe");
        InitializeWithWindow.Initialize(picker, WindowNative.GetWindowHandle(this));
        var chosen = await picker.PickSingleFileAsync();
        if (chosen is not null) await RunAsync(action, chosen.Path);
    }

    private async void RunAction(object sender, RoutedEventArgs args)
    {
        if (sender is Button { Tag: string action }) await RunAsync(action);
    }

    private async void Restart(object sender, RoutedEventArgs args)
    {
        if (busy || confirming) return;
        if (state?.Status is "ready" or "waiting" &&
            !await ConfirmAsync("重新启动服务", "重新启动会暂时中断 OBS 输出与 OCLR 连接，比赛记录会保留。")) return;
        await RunAsync("restart", PortBox.Text);
    }

    private async Task<bool> ConfirmAsync(string title, string content)
    {
        if (confirming) return false;
        confirming = true;
        try
        {
            var dialog = new ContentDialog
            {
                Title = title, Content = content, XamlRoot = Root.XamlRoot,
                PrimaryButtonText = "继续", CloseButtonText = "取消", DefaultButton = ContentDialogButton.Close,
            };
            return await dialog.ShowAsync() == ContentDialogResult.Primary;
        }
        finally { confirming = false; }
    }

    private async Task ExitAsync()
    {
        if (busy || confirming || canClose) return;
        if (state?.Status is "ready" or "waiting" &&
            !await ConfirmAsync("退出直播服务", "退出会停止 OBS 输出。再次启动会恢复已保存的比赛。")) return;
        timer.Stop();
        busy = true;
        try { if (bridge is not null && state is not null) await bridge.RequestAsync("stop"); }
        catch (IOException) { }
        finally
        {
            canClose = true;
            Close();
        }
    }

    private async void ExitClicked(object sender, RoutedEventArgs args) => await ExitAsync();
    private void OpenConsole(object sender, RoutedEventArgs args) => OpenTarget(state?.Base + "/control");
    private void OpenLog(object sender, RoutedEventArgs args) => OpenTarget(state?.LogPath);
    private void CopyObs(object sender, RoutedEventArgs args) => CopyText(ObsAddress.Text);
    private void CopyAddresses(object sender, RoutedEventArgs args)
    {
        if (state is not { Base.Length: > 0 }) return;
        CopyText(string.Join("\r\n", state.Base + "/control", state.Base + "/overlay", state.Base + "/showcase?clean=1"));
    }

    private void CopyText(string text)
    {
        var data = new DataPackage();
        data.SetText(text);
        try
        {
            Clipboard.SetContent(data);
            Feedback.Text = SettingsFeedback.Text = "地址已复制。";
        }
        catch (COMException) { Feedback.Text = SettingsFeedback.Text = "剪贴板正忙，请重试。"; }
    }

    private void OpenTarget(string? target)
    {
        if (string.IsNullOrEmpty(target)) return;
        try { Process.Start(new ProcessStartInfo(target) { UseShellExecute = true })?.Dispose(); }
        catch (System.ComponentModel.Win32Exception) { Feedback.Text = SettingsFeedback.Text = "无法打开所选地址或文件。"; }
    }
}
