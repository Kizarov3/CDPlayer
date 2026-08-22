/// Which particle effect a theme drives, if any — port of desktop's
/// `ThemeOverlay.Mode` (`CDPlayer.java:5291`). RED/BLUE/SUNSET/FOREST/AUTO
/// have no particle effect of their own, same as desktop.
enum ParticleMode { none, snow, ocean, autumn, galaxy, matrix }

ParticleMode particleModeForTheme(String themeName) {
  switch (themeName) {
    case 'SNOW':
      return ParticleMode.snow;
    case 'OCEAN':
      return ParticleMode.ocean;
    case 'AUTUMN':
      return ParticleMode.autumn;
    case 'GALAXY':
      return ParticleMode.galaxy;
    case 'MATRIX':
      return ParticleMode.matrix;
    default:
      return ParticleMode.none;
  }
}
