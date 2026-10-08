{ lib, stdenvNoCC, bun, fetchurl, makeWrapper }:

let
  # elkjs has no dependencies, so one tarball is the whole node_modules.
  elkjs = fetchurl {
    url = "https://registry.npmjs.org/elkjs/-/elkjs-0.12.0.tgz";
    hash = "sha256-wddxlyPgILEHJOPMvJNWlqKITx5402HN0DdmMJ6Ojio=";
  };
in
stdenvNoCC.mkDerivation {
  pname = "schema-diagram";
  version = "0.1.0";
  src = ./schema-diagram.ts;
  dontUnpack = true;
  nativeBuildInputs = [ makeWrapper ];
  installPhase = ''
    mkdir -p $out/lib/schema-diagram/node_modules/elkjs $out/bin
    cp $src $out/lib/schema-diagram/schema-diagram.ts
    tar -xzf ${elkjs} -C $out/lib/schema-diagram/node_modules/elkjs --strip-components=1
    makeWrapper ${lib.getExe bun} $out/bin/schema-diagram \
      --add-flags "$out/lib/schema-diagram/schema-diagram.ts"
  '';
  meta.mainProgram = "schema-diagram";
}
