(function () {
  function resize() {
    var viewport = window.visualViewport;
    var height = viewport ? Math.round(viewport.height * viewport.scale) : window.innerHeight;
    document.documentElement.style.setProperty('--app-height', height + 'px');
  }
  window.addEventListener('resize', resize);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', resize);
  resize();
})();
