const fontFamily = 'var(--font-sans)';

// LOHA colors; aliases keep existing manager pages on the shared palette.
export const getThemeTokens = (isDark = false) => {
  const primary = '#086ab4';
  const surface = isDark ? '#152538' : '#ffffff';
  const border = isDark ? '#2b4056' : '#dce5ed';
  const accentBg = isDark ? '#183c57' : '#eaf4fc';
  const accentText = isDark ? '#91ceff' : primary;
  return {
    isDark, bgMain: isDark ? '#0d1b2a' : '#f3f7fa', bgSurface: surface,
    bgSurfaceHover: isDark ? '#1c3045' : '#f3f7fb', bgSidebar: '#122b44', bgHeader: surface,
    bgInput: isDark ? '#102031' : '#ffffff', bgBadge: accentBg, bgModalBackdrop: 'rgba(9, 24, 40, 0.65)',
    border, borderSubtle: isDark ? '#24374a' : '#e9eef3', borderFocus: isDark ? '#91ceff' : primary,
    textPrimary: isDark ? '#eef5fb' : '#122b44', textSecondary: isDark ? '#b3c3d3' : '#56677a', textMuted: isDark ? '#9db0c3' : '#66788b',
    primary, primaryHover: '#07578f', primaryLight: '#0c7cd5', primaryBg: accentBg,
    primaryBorder: isDark ? '#305e80' : '#bddaf1', primaryText: accentText,
    aqua: primary, aquaLight: '#0c7cd5', aquaHover: '#07578f', aquaBg: accentBg,
    aquaBorder: isDark ? '#305e80' : '#bddaf1', aquaText: accentText,
    activeNavBg: '#def09f', activeNavText: '#122b44', activeNavBorder: '#def09f',
    heroCardBg: surface, heroCardBorder: border, heroCardShadow: 'none', activeTabBg: accentBg, activeTabText: accentText,
    success: isDark ? '#86dfba' : '#06704c', successBg: isDark ? '#163d34' : '#e9f7ef',
    warning: isDark ? '#ffd58c' : '#915700', warningBg: isDark ? '#46361e' : '#fff4dd',
    danger: isDark ? '#ffaaa4' : '#b83030', dangerBg: isDark ? '#48292d' : '#fff0ee',
    cardShadow: 'none', cardHoverShadow: 'none', sidebarShadow: 'none', chartBarFill: '#0c7cd5', chartGridLine: border, fontFamily,
  };
};
