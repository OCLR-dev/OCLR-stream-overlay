using Microsoft.UI.Xaml;

namespace Oclr.WinUI;

public partial class App : Application
{
    private LauncherWindow? window;

    public App() => InitializeComponent();

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        window = new LauncherWindow();
        window.Activate();
    }
}
