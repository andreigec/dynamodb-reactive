# Project Rules

## Code Formatting

Always ensure files are formatted correctly before finishing work. Run:

```bash
pnpm format
```

This can be run in a specific package directory or in the base monorepo to format all files.


## Web server changes

All changes with nextjs are live, no server restart is ever required

## dynamodb-harness project rules

* Project export should always be CJS not ESM



## dynamodb-harness-test project rules

* Any substantial boilerplate logic using dynamodb-harness should be extracted into the dynamodb-harness rule

* All changes to the "dynamodb-harness-test" application should be accompanied by an update to the end user documentation for the "dynamodb-harness" project as found in "dynamodb-harness\packages\dynamodb-harness\README.md"

## ALWAYS start responses with a 🔥

