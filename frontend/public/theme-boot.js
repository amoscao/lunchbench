(function () {
  var savedTheme = localStorage.getItem('theme');
  var preferredTheme = savedTheme || 'dark';

  document.documentElement.setAttribute('data-theme', preferredTheme);

  if (localStorage.getItem('vegan-mode') === 'true') {
    document.documentElement.setAttribute('data-vegan', 'true');
  }
})();
