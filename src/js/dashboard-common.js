uDom.onLoad(function() {
uDom('a').attr('target', '_blank');
uDom('a[href*="dashboard.html"]').attr('target', '_parent');
uDom('.whatisthis').on('click', function() {
    uDom(this).parent()
        .descendants('.whatisthis-expandable')
        .toggleClass('whatisthis-expanded');
});

});
