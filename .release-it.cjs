module.exports = {
  git: {
    commitMessage: 'chore: release v${version}',
    tagName: 'v${version}',
  },
  github: {
    release: true,
    releaseNotes: 'toJSON(changelog)',
  },
  npm: {
    publish: true,
  },
  hooks: {
    'before:init': 'pnpm run build',
  },
  plugins: {
    '@release-it/conventional-changelog': {
      preset: { name: 'angular' },
      infile: 'CHANGELOG.md',
      writerOpts: {
        transform(commit) {
          if (!commit.type) return null
          if (commit.type === 'chore' && /^release/.test(commit.subject)) return null
          if (/^Merge /.test(commit.header)) return null
          return commit
        },
      },
    },
  },
}
