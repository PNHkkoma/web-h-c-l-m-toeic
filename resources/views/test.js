const collapsedSections = document.querySelectorAll('.collapsed-section');
collapsedSections.forEach((section) => {
  section.addEventListener('click', function(e) {
    e.preventDefault();
    const collapsedDiv = this.nextElementSibling;
    const collapsedLinks = collapsedDiv.querySelectorAll('a');
    collapsedDiv.classList.toggle('collapsed');
    collapsedLinks.forEach((link) => {
      link.addEventListener('click', function(e) {
        e.stopPropagation();
      });
    });
  });
});
