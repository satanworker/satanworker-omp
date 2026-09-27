{
  description = "Shared AI agent configuration";

  outputs = { self }: {
    homeManagerModules.default = import ./home-manager.nix;
  };
}
