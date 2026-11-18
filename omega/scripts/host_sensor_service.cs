using System;
using System.Diagnostics;
using System.IO;
using System.ServiceProcess;

// SCM entry point. Arguments contain paths and tenant/SID only, never a secret.
public sealed class OmegaAgentService : ServiceBase {
    private Process sensor;
    private readonly string[] config;
    public OmegaAgentService(string[] args) { ServiceName = "omega-agent"; config = args; }
    protected override void OnStart(string[] args) {
        if (config.Length != 5) throw new InvalidOperationException("Invalid omega-agent configuration");
        var bundled = config[1] == "--bundled";
        var arguments = (bundled ? "" : "-I -S \"" + config[1] + "\" ") + "--service --endpoint \"" + config[2] + "\"";
        var start = new ProcessStartInfo(config[0], arguments);
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WorkingDirectory = Path.GetDirectoryName(config[1]);
        start.EnvironmentVariables.Remove("INTERNAL_SERVICE_TOKEN");
        start.EnvironmentVariables.Remove("PYTHONPATH");
        start.EnvironmentVariables["OMEGA_HOST_OWNER_TENANT_ID"] = config[3];
        start.EnvironmentVariables["OMEGA_SENSOR_USER_SID"] = config[4];
        start.EnvironmentVariables["OMEGA_HOST_IOC_SOURCE"] = "gateway";
        start.EnvironmentVariables["OMEGA_REALTIME_ENABLED"] = "true";
        if (bundled) {
            start.EnvironmentVariables["OMEGA_CONTAINMENT_ENABLED"] = "true";
            start.EnvironmentVariables["OMEGA_CONTAINMENT_DIR"] = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OMEGA", "quarantine");
        }
        sensor = Process.Start(start);
        if (sensor.WaitForExit(1500)) throw new InvalidOperationException("Sensor failed startup integrity verification");
        sensor.EnableRaisingEvents = true;
        sensor.Exited += delegate { ExitCode = 1; Stop(); };
    }
    protected override void OnStop() {
        var child = sensor;
        sensor = null;
        if (child != null) { child.EnableRaisingEvents = false; if (!child.HasExited) child.Kill(); child.Dispose(); }
    }
    public static void Main(string[] args) { ServiceBase.Run(new OmegaAgentService(args)); }
}
