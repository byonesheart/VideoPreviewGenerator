const INFO_FIELDS = [
  'folder', 'filename', 'size', 'resolution', 'fps',
  'duration', 'videoCodec', 'audioCodec', 'subtitles'
];

const DEFAULT_JPG_STYLE = {
  jpgInfoEnabled: false,
  jpgInfoLanguage: 'zh',
  jpgInfoFields: ['filename', 'size', 'resolution', 'fps', 'duration', 'videoCodec', 'audioCodec'],
  jpgSizeUnit: 'MB',
  jpgInfoFont: 'yahei',
  jpgInfoFontSize: 22,
  jpgInfoColor: '#ffffff',
  jpgInfoPosition: 'top',
  jpgCommentEnabled: false,
  jpgComment: '',
  jpgTileBorder: false,
  jpgTileBorderWidth: 5,
  jpgGrayscale: false,
  jpgOuterBorder: false,
  jpgOuterBorderWidth: 8,
  jpgOuterBorderColor: '#ffffff',
  jpgBevel: false,
  jpgBevelWidth: 4
};

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.floor(number))) : fallback;
}

function color(value, fallback) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

function normalizeJpgStyle(input = {}) {
  const defaults = DEFAULT_JPG_STYLE;
  const fields = Array.isArray(input.jpgInfoFields) ? input.jpgInfoFields : defaults.jpgInfoFields;
  return {
    jpgInfoEnabled: input.jpgInfoEnabled === true,
    jpgInfoLanguage: input.jpgInfoLanguage === 'en' ? 'en' : 'zh',
    jpgInfoFields: INFO_FIELDS.filter((field) => fields.includes(field)),
    jpgSizeUnit: ['B', 'MB', 'GB'].includes(input.jpgSizeUnit) ? input.jpgSizeUnit : defaults.jpgSizeUnit,
    jpgInfoFont: ['yahei', 'simhei', 'arial'].includes(input.jpgInfoFont) ? input.jpgInfoFont : defaults.jpgInfoFont,
    jpgInfoFontSize: boundedInteger(input.jpgInfoFontSize, defaults.jpgInfoFontSize, 12, 36),
    jpgInfoColor: color(input.jpgInfoColor, defaults.jpgInfoColor),
    jpgInfoPosition: input.jpgInfoPosition === 'bottom' ? 'bottom' : 'top',
    jpgCommentEnabled: input.jpgCommentEnabled === true,
    jpgComment: typeof input.jpgComment === 'string' ? input.jpgComment.replace(/[\r\n]/g, ' ').slice(0, 160) : '',
    jpgTileBorder: input.jpgTileBorder === true,
    jpgTileBorderWidth: boundedInteger(input.jpgTileBorderWidth, defaults.jpgTileBorderWidth, 1, 20),
    jpgGrayscale: input.jpgGrayscale === true,
    jpgOuterBorder: input.jpgOuterBorder === true,
    jpgOuterBorderWidth: boundedInteger(input.jpgOuterBorderWidth, defaults.jpgOuterBorderWidth, 1, 30),
    jpgOuterBorderColor: color(input.jpgOuterBorderColor, defaults.jpgOuterBorderColor),
    jpgBevel: input.jpgBevel === true,
    jpgBevelWidth: boundedInteger(input.jpgBevelWidth, defaults.jpgBevelWidth, 1, 12)
  };
}

module.exports = { INFO_FIELDS, DEFAULT_JPG_STYLE, normalizeJpgStyle };
