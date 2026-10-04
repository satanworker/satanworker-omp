{ config, lib, pkgs, ... }:

let
  ompCfg = config.satanworker.omp;
  claudeCfg = config.satanworker.claude;
  machineConfig = (pkgs.formats.yaml { }).generate "omp-machine-config.yml" ompCfg.overrides;
  configFiles =
    [ "${./config.yml}" ]
    ++ lib.optional (ompCfg.overrides != { }) "${machineConfig}";
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

    packages = lib.mkOption {
      type = lib.types.attrsOf (lib.types.nullOr lib.types.package);
      description = ''
        Language servers and tools OMP uses, by name. Set a shared entry to
        null to drop it on one machine; add entries for machine-only tools.
      '';
    };
  };

  options.satanworker.claude = {
    enable = lib.mkEnableOption "shared Claude Code configuration";

    command = lib.mkOption {
      type = lib.types.str;
      default = "claude";
      description = "Claude Code executable used during activation";
    };
  };

  config = lib.mkMerge [
    (lib.mkIf ompCfg.enable {
      satanworker.omp.packages = lib.mapAttrs (_: lib.mkDefault) {
        inherit (pkgs)
          gopls
          typescript
          typescript-language-server
          tailwindcss-language-server
          vscode-langservers-extracted;
      };
      home.packages = lib.filter (p: p != null) (lib.attrValues ompCfg.packages);
      home.sessionVariables.PI_CONFIG_FILES = overlayPaths;
      home.file.".omp/agent/agents/grok-research.md".source = ./agents/grok-research.md;
      home.file.".omp/agent/AGENTS.md".source = ./AGENTS.md;
      home.file.".omp/agent/extensions/x-search.ts".source = ./extensions/x-search.ts;
      xdg.configFile."fish/conf.d/10-satanworker-omp.fish".text = ''
        set -gx PI_CONFIG_FILES ${lib.escapeShellArg overlayPaths}
      '';
    })

    (lib.mkIf claudeCfg.enable {
      home.activation.installClaudePonytail = lib.hm.dag.entryAfter [ "writeBoundary" ] ''
        claude=${lib.escapeShellArg claudeCfg.command}
        export PATH="${pkgs.git}/bin:${pkgs.nodejs_24}/bin:$PATH"

        if ! "$claude" plugin marketplace list --json \
          | ${pkgs.jq}/bin/jq -e '.[] | select(.name == "ponytail")' >/dev/null; then
          "$claude" plugin marketplace add --scope user DietrichGebert/ponytail
        fi

        if ! "$claude" plugin list --json \
          | ${pkgs.jq}/bin/jq -e '.[] | select(.id == "ponytail@ponytail" and .enabled == true)' >/dev/null; then
          "$claude" plugin install --scope user --yes ponytail@ponytail
        fi
      '';
    })
  ];
}
