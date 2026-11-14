# Bundled JavaScript security rules

Source: https://github.com/qodana/opengrep-sast-rules

Pinned commit: `bbf0bcd00d9db0c9dbbd40d40fab69dfc1518a24`

The rule files are copied unchanged from these upstream directories:

- `javascript/`: 9 MIT-licensed rule files, copyright GitLab Inc.
- `rules/lgpl/javascript/`: 75 LGPL-3.0 rule files. Original authors,
  source URLs and attribution are preserved in each rule's header.

Licence texts accompany this bundle in `LICENSE-MIT`, `LICENSE-LGPL-3.0`
and `LICENSE-GPL-3.0`. These licences apply to the corresponding rule files;
they do not assign a new licence to all LaunchGuard code.

The editable YAML files are the bundled rules' source. Preserve their notices
when distributing them. If changing LGPL rules, identify the modifications,
retain their applicable licence and provide the modified source to users.
Include these notices and licence texts in deployments and make them available
to users when exposing scanner results.

No files from upstream `jetbrains/`, `rules/lgpl-cc/` or `rules/gitlab/`
are included. Adding another upstream directory requires a separate licence
and compatibility check.

Coverage is rule-specific. Several rules explicitly support TypeScript, but
this bundle does not establish complete JavaScript, TypeScript or framework
coverage. Findings require contextual review.

Upstream matching/non-matching fixtures are available at the pinned source
commit. They are test inputs, not application code to execute.
