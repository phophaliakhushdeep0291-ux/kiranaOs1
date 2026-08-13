using System.Diagnostics;
using System.Drawing.Printing;
using System.Net.Http.Headers;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace KiranaOS.HardwareBridge.Setup;

internal sealed class PairingState
{
    [JsonPropertyName("salt")] public string Salt { get; set; } = "";
    [JsonPropertyName("digest")] public string Digest { get; set; } = "";
    [JsonPropertyName("expiresAt")] public long ExpiresAt { get; set; }
    [JsonPropertyName("consumedAt")] public long? ConsumedAt { get; set; }
    [JsonPropertyName("failedAttempts")] public int FailedAttempts { get; set; }
}

internal sealed class PrinterConfig
{
    [JsonPropertyName("transport")] public string Transport { get; set; } = "windows";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("host")] public string Host { get; set; } = "";
    [JsonPropertyName("port")] public int Port { get; set; } = 9100;
}

internal class ExecutableAdapterConfig
{
    [JsonPropertyName("executable")] public string Executable { get; set; } = "";
    [JsonPropertyName("args")] public string[] Args { get; set; } = [];
}

internal sealed class CustomerDisplayConfig : ExecutableAdapterConfig
{
    [JsonPropertyName("width")] public int Width { get; set; } = 20;
}

internal sealed class TallyConfig
{
    [JsonPropertyName("url")] public string Url { get; set; } = "";
}

internal sealed class BridgeConfig
{
    [JsonPropertyName("version")] public int Version { get; set; } = 1;
    [JsonPropertyName("token")] public string Token { get; set; } = "";
    [JsonPropertyName("allowedOrigins")] public string[] AllowedOrigins { get; set; } =
        ["http://localhost:5173", "http://127.0.0.1:5173"];
    [JsonPropertyName("printer")] public PrinterConfig Printer { get; set; } = new();
    [JsonPropertyName("scale")] public ExecutableAdapterConfig Scale { get; set; } = new();
    [JsonPropertyName("customerDisplay")] public CustomerDisplayConfig CustomerDisplay { get; set; } = new();
    [JsonPropertyName("pairing")] public PairingState? Pairing { get; set; }
    // Saving this window rewrites the whole file, so a key it does not know
    // about is a key it silently deletes. The Tally address is set by hand
    // today, and losing it on the next printer change would take the counter's
    // accounting link down with no visible cause.
    [JsonPropertyName("tally")] public TallyConfig Tally { get; set; } = new();
    [JsonPropertyName("updateManifestUrl")] public string UpdateManifestUrl { get; set; } =
        "https://updates.kiranaos.in/hardware-bridge/stable.json";
}

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new SetupWindow());
    }
}

internal sealed class SetupWindow : Form
{
    private const string ServiceExecutable = "KiranaOSHardwareBridge.exe";
    private static readonly string ConfigDirectory = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "KiranaOS", "HardwareBridge");
    private static readonly string ConfigPath = Path.Combine(ConfigDirectory, "config.json");
    private readonly ComboBox printers = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 440 };
    private readonly Label pairingCode = new() { AutoSize = false, Width = 440, Height = 58, Font = new Font("Segoe UI", 27, FontStyle.Bold), TextAlign = ContentAlignment.MiddleCenter };
    private readonly Label status = new() { AutoSize = false, Width = 440, Height = 56, TextAlign = ContentAlignment.MiddleLeft };
    private readonly Label version = new() { AutoSize = true };
    private readonly Button saveButton = new() { Text = "Save printer and create pairing code", Width = 440, Height = 44 };
    private readonly Button testButton = new() { Text = "Test print", Width = 212, Height = 44, Enabled = false };
    private readonly Button refreshButton = new() { Text = "Refresh printers", Width = 212, Height = 44 };
    private readonly TextBox scaleAdapter = new() { Width = 340, ReadOnly = true, PlaceholderText = "Not configured" };
    private readonly TextBox displayAdapter = new() { Width = 340, ReadOnly = true, PlaceholderText = "Not configured" };
    private readonly Button chooseScaleAdapter = new() { Text = "Choose...", Width = 88, Height = 30 };
    private readonly Button chooseDisplayAdapter = new() { Text = "Choose...", Width = 88, Height = 30 };
    private BridgeConfig config = new();

    public SetupWindow()
    {
        Text = "KiranaOS Hardware Bridge Setup";
        ClientSize = new Size(500, 640);
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 10);

        var heading = new Label { Text = "Connect your receipt printer", AutoSize = true, Font = new Font("Segoe UI", 16, FontStyle.Bold) };
        var explanation = new Label { Text = "Choose the printer used for bills. No terminal or private token is needed.", AutoSize = false, Width = 440, Height = 42 };
        var printerLabel = new Label { Text = "Installed printer", AutoSize = true };
        var scaleLabel = new Label { Text = "Optional weighing-scale vendor adapter (.exe)", AutoSize = true };
        var displayLabel = new Label { Text = "Optional customer-display vendor adapter (.exe)", AutoSize = true };
        var codeLabel = new Label { Text = "Type this code in KiranaOS → Printer Settings", AutoSize = true };
        version.Text = $"Hardware Bridge v{Application.ProductVersion}";

        var buttons = new FlowLayoutPanel { Width = 440, Height = 50, FlowDirection = FlowDirection.LeftToRight, WrapContents = false };
        buttons.Controls.Add(testButton);
        buttons.Controls.Add(refreshButton);
        var scaleRow = new FlowLayoutPanel { Width = 440, Height = 36, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0) };
        scaleRow.Controls.Add(scaleAdapter);
        scaleRow.Controls.Add(chooseScaleAdapter);
        var displayRow = new FlowLayoutPanel { Width = 440, Height = 36, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0) };
        displayRow.Controls.Add(displayAdapter);
        displayRow.Controls.Add(chooseDisplayAdapter);
        var panel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(28, 24, 28, 18), WrapContents = false };
        panel.Controls.Add(heading);
        panel.Controls.Add(explanation);
        panel.Controls.Add(printerLabel);
        panel.Controls.Add(printers);
        panel.SetFlowBreak(printers, true);
        panel.Controls.Add(scaleLabel);
        panel.Controls.Add(scaleRow);
        panel.Controls.Add(displayLabel);
        panel.Controls.Add(displayRow);
        panel.Controls.Add(saveButton);
        panel.Controls.Add(codeLabel);
        panel.Controls.Add(pairingCode);
        panel.Controls.Add(buttons);
        panel.Controls.Add(status);
        panel.Controls.Add(version);
        Controls.Add(panel);

        saveButton.Click += async (_, _) => await SaveAndPairAsync();
        testButton.Click += async (_, _) => await TestPrintAsync();
        refreshButton.Click += (_, _) => LoadPrinters();
        chooseScaleAdapter.Click += (_, _) => ChooseAdapter(scaleAdapter, "Choose the weighing-scale vendor adapter");
        chooseDisplayAdapter.Click += (_, _) => ChooseAdapter(displayAdapter, "Choose the customer-display vendor adapter");
        Shown += async (_, _) => { LoadConfig(); LoadPrinters(); await RefreshVersionNoticeAsync(); };
    }

    private void LoadConfig()
    {
        try
        {
            if (File.Exists(ConfigPath)) config = JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(ConfigPath)) ?? new();
            else
            {
                var defaultsPath = Path.Combine(AppContext.BaseDirectory, "bridge-defaults.json");
                if (File.Exists(defaultsPath)) config = JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(defaultsPath)) ?? new();
            }
            scaleAdapter.Text = config.Scale?.Executable ?? "";
            displayAdapter.Text = config.CustomerDisplay?.Executable ?? "";
        }
        catch { status.Text = "Previous setup could not be read. Choose the printer again."; }
    }

    private void ChooseAdapter(TextBox target, string title)
    {
        using var picker = new OpenFileDialog
        {
            Title = title,
            Filter = "Vendor adapter executable (*.exe)|*.exe",
            CheckFileExists = true,
            Multiselect = false,
        };
        if (picker.ShowDialog(this) == DialogResult.OK) target.Text = Path.GetFullPath(picker.FileName);
    }

    private static string InstallProtectedAdapter(string sourcePath, string adapterKind)
    {
        if (string.IsNullOrWhiteSpace(sourcePath)) return "";
        var source = Path.GetFullPath(sourcePath);
        var payload = File.ReadAllBytes(source);
        var fingerprint = Convert.ToHexString(SHA256.HashData(payload)).ToLowerInvariant()[..16];
        var adapterDirectory = Path.Combine(ConfigDirectory, "adapters");
        Directory.CreateDirectory(adapterDirectory);
        var destination = Path.Combine(adapterDirectory, $"{adapterKind}-{fingerprint}.exe");
        if (string.Equals(source, destination, StringComparison.OrdinalIgnoreCase)) return destination;
        if (!File.Exists(destination))
        {
            var temporary = destination + ".tmp";
            File.WriteAllBytes(temporary, payload);
            File.Move(temporary, destination, true);
        }
        return destination;
    }

    private void LoadPrinters()
    {
        var selected = printers.SelectedItem?.ToString() ?? config.Printer.Name;
        printers.Items.Clear();
        foreach (string printer in PrinterSettings.InstalledPrinters) printers.Items.Add(printer);
        if (!string.IsNullOrWhiteSpace(selected) && printers.Items.Contains(selected)) printers.SelectedItem = selected;
        else if (printers.Items.Count > 0) printers.SelectedIndex = 0;
        status.Text = printers.Items.Count == 0
            ? "No installed printer found. Connect it and install its Windows driver, then press Refresh printers."
            : $"Found {printers.Items.Count} installed printer(s).";
    }

    private async Task SaveAndPairAsync()
    {
        if (printers.SelectedItem is not string printerName)
        {
            status.Text = "Choose an installed printer first.";
            return;
        }
        foreach (var adapterPath in new[] { scaleAdapter.Text.Trim(), displayAdapter.Text.Trim() }.Where(value => value.Length > 0))
        {
            if (!adapterPath.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || !File.Exists(adapterPath))
            {
                status.Text = "Choose an installed .exe adapter, or clear the optional adapter field.";
                return;
            }
        }
        saveButton.Enabled = false;
        try
        {
            // Creating a new pairing code is also the explicit credential-rotation
            // action. Any previously paired browser must use the new one-time code.
            config.Token = RandomToken();
            config.Printer = new PrinterConfig { Transport = "windows", Name = printerName };
            config.Scale ??= new ExecutableAdapterConfig();
            config.Scale.Executable = InstallProtectedAdapter(scaleAdapter.Text.Trim(), "scale");
            config.Scale.Args = [];
            config.CustomerDisplay ??= new CustomerDisplayConfig();
            config.CustomerDisplay.Executable = InstallProtectedAdapter(displayAdapter.Text.Trim(), "customer-display");
            config.CustomerDisplay.Args = [];
            config.CustomerDisplay.Width = 20;
            var code = RandomCode();
            var salt = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
            config.Pairing = new PairingState
            {
                Salt = salt,
                Digest = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{salt}:{code}"))).ToLowerInvariant(),
                ExpiresAt = DateTimeOffset.UtcNow.AddMinutes(10).ToUnixTimeMilliseconds(),
                FailedAttempts = 0,
            };
            Directory.CreateDirectory(ConfigDirectory);
            var temporary = ConfigPath + ".tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporary, ConfigPath, true);
            RestartService();
            await WaitForBridgeAsync();
            await RefreshVersionNoticeAsync();
            pairingCode.Text = code;
            status.Text = "Ready. This code expires in 10 minutes and works once.";
            testButton.Enabled = true;
        }
        catch
        {
            status.Text = "Setup could not be saved. Close this window, reopen Hardware Bridge Setup, and try again.";
        }
        finally { saveButton.Enabled = true; }
    }

    private async Task TestPrintAsync()
    {
        testButton.Enabled = false;
        status.Text = "Printing the test receipt…";
        try
        {
            using var client = new HttpClient { BaseAddress = new Uri("http://127.0.0.1:17873"), Timeout = TimeSpan.FromSeconds(15) };
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", config.Token);
            using var response = await client.PostAsync("/v1/test-print", new StringContent("{}", Encoding.UTF8, "application/json"));
            status.Text = response.IsSuccessStatusCode
                ? "Test receipt printed successfully."
                : "Printer is off, disconnected, or out of paper. Check it and press Test print again.";
        }
        catch { status.Text = "Printer is off, disconnected, or out of paper. Check it and press Test print again."; }
        finally { testButton.Enabled = true; }
    }

    private static void RestartService()
    {
        var servicePath = Path.Combine(AppContext.BaseDirectory, ServiceExecutable);
        if (!File.Exists(servicePath)) return;
        RunHidden(servicePath, "stop");
        RunHidden(servicePath, "start");
    }

    private static async Task WaitForBridgeAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromMilliseconds(500) };
        for (var attempt = 0; attempt < 20; attempt++)
        {
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, "http://127.0.0.1:17873/v1/health");
                request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", LoadToken());
                using var response = await client.SendAsync(request);
                if (response.IsSuccessStatusCode) return;
            }
            catch { }
            await Task.Delay(250);
        }
        throw new InvalidOperationException();
    }

    private async Task RefreshVersionNoticeAsync()
    {
        if (string.IsNullOrWhiteSpace(config.Token)) return;
        try
        {
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
            using var request = new HttpRequestMessage(HttpMethod.Get, "http://127.0.0.1:17873/v1/health");
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", config.Token);
            using var response = await client.SendAsync(request);
            if (!response.IsSuccessStatusCode) return;
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = document.RootElement;
            var installed = root.TryGetProperty("version", out var current) ? current.GetString() : Application.ProductVersion;
            version.Text = $"Hardware Bridge v{installed}";
            if (root.TryGetProperty("update", out var update)
                && update.TryGetProperty("available", out var available) && available.GetBoolean()
                && update.TryGetProperty("latestVersion", out var latest))
            {
                version.Text += $"  ·  Update {latest.GetString()} available";
                version.ForeColor = Color.DarkOrange;
            }
        }
        catch { /* version remains visible even when the update service is offline */ }
    }

    private static string LoadToken()
    {
        try { return JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(ConfigPath))?.Token ?? ""; }
        catch { return ""; }
    }

    private static void RunHidden(string executable, string arguments)
    {
        using var process = Process.Start(new ProcessStartInfo(executable, arguments) { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
        process?.WaitForExit(10_000);
    }

    private static string RandomToken() => Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).Replace("+", "-").Replace("/", "_").TrimEnd('=');
    private static string RandomCode()
    {
        const string alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
        var bytes = RandomNumberGenerator.GetBytes(6);
        return string.Concat(bytes.Select(value => alphabet[value % alphabet.Length]));
    }
}
