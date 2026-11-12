# OMP Configuration

- By default, every OMP change (settings, model roles, agents, LSP packages, these instructions) goes through `satanworker-omp` (github.com/satanworker/satanworker-omp; Mac checkout `~/Developer/NixOS/satanworker-omp`) so it applies to both the Mac (`satanworker`) and the VPS (`home-satan`).
- Make a machine-specific change only when the user names `satanworker` or `home-satan`: use `satanworker.omp.overrides` / `satanworker.omp.packages` in `satanworker/home/default.nix` or `home-satan/modules/omp.nix`.
- Never persist OMP changes by editing `~/.omp/agent/config.yml` or saving `cfg://` writes: the shared config is layered over it via `PI_CONFIG_FILES` and the change is lost on other machines.
- To roll out: commit and push `satanworker-omp`, then `nix flake update satanworker-omp` in both `satanworker` and `home-satan`, and rebuild (`darwin-rebuild switch --flake .` on the Mac; `make switch` in `home-satan`).

- Research: every model (Grok, Opus, GLM, Sonnet) uses `web_search` (Exa) **and** `x_search` (xAI). Do not treat X search as Grok-only. Never `web_search site:x.com`.
