{
  description = "Shared Oh My Pi configuration";

  outputs = { self }: {
    homeManagerModules.default = import ./home-manager.nix;
  };
}
