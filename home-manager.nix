{ config, lib, pkgs, ... }:

let
  cfg = config.satanworker.omp;
  machineConfig = (pkgs.formats.yaml { }).generate "omp-machine-config.yml" cfg.overrides;
  configFiles =
    [ "${./config.yml}" ]
    ++ lib.optional (cfg.overrides != { }) "${machineConfig}";
  overlayPaths = lib.concatStringsSep ":" configFiles;
in
{
  options.satanworker.omp = {
    enable = lib.mkEnableOption "shared Oh My Pi configuration";

    overrides = lib.mkOption {
      type = lib.types.attrs;
      default = { };
      description = "Machine-specific OMP settings layered over the shared configuration";
    };
  };

  config = lib.mkIf cfg.enable {
    home.sessionVariables.PI_CONFIG_FILES = overlayPaths;
    xdg.configFile."fish/conf.d/10-satanworker-omp.fish".text = ''
      set -gx PI_CONFIG_FILES ${lib.escapeShellArg overlayPaths}
    '';
  };
}
