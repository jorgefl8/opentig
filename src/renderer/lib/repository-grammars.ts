import type { LanguageRegistration } from 'shiki';

// These repository formats have no grammar in the bundled Shiki registry.
const comment = { name: 'comment.line.number-sign', match: '^\\s*#.*$' };
const globPatterns = [
  { name: 'constant.character.escape', match: '\\\\.' },
  { name: 'keyword.operator', match: '[*?]|\\[[^\\]]*\\]' },
];

export const gitignore: LanguageRegistration = {
  name: 'gitignore', scopeName: 'source.gitignore', repository: {},
  patterns: [comment, {
    name: 'string.unquoted.path', begin: '^(?!#)(!?)', end: '$',
    beginCaptures: { 1: { name: 'keyword.operator.negation' } },
    patterns: globPatterns,
  }],
};

export const gitattributes: LanguageRegistration = {
  name: 'gitattributes', scopeName: 'source.gitattributes', repository: {},
  patterns: [comment,
    { name: 'string.unquoted.path', match: '^\\S+' },
    { name: 'keyword.operator', match: '(?<=\\s)[!-]' },
    { name: 'entity.other.attribute-name', match: '(?<=\\s)[\\w.-]+(?==|\\s|$)' },
    { name: 'string.unquoted', match: '(?<==)[^\\s]+' },
  ],
};

export const nsis: LanguageRegistration = {
  name: 'nsis', scopeName: 'source.nsis',
  patterns: [
    { name: 'comment.line', match: '[;#].*$' },
    { name: 'comment.block', begin: '/\\*', end: '\\*/' },
    { name: 'keyword.control.directive', match: '(?i)^\\s*![a-z]+' },
    { name: 'keyword.control', match: '(?i)^\\s*(?:Function(?:End)?|Section(?:End|Group|GroupEnd)?|Page|UninstPage|Var|Name|OutFile|InstallDir|RequestExecutionLevel|SetShellVarContext|SetOutPath|File|ExecWait|Exec|Delete|RMDir|WriteRegStr|ReadRegStr|StrCpy|DetailPrint|MessageBox|Abort|Return|Call|Goto|IfFileExists)\\b' },
    { name: 'string.quoted.double', begin: '"', end: '"', patterns: [{ include: '#variables' }] },
    { name: 'string.quoted.single', begin: "'", end: "'", patterns: [{ include: '#variables' }] },
    { include: '#variables' },
    { name: 'constant.numeric', match: '\\b(?:0x[0-9a-fA-F]+|[0-9]+)\\b' },
  ],
  repository: {
    variables: { patterns: [{ name: 'variable.other', match: '\\$(?:\\{[^}]+\\}|[A-Za-z_][A-Za-z_0-9]*|[0-9])' }] },
  },
};
