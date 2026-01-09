# Project Rules

## Code Formatting

Always ensure files are formatted correctly before finishing work. Run:

```bash
pnpm format
```

This can be run in a specific package directory or in the base monorepo to format all files.


## Web server changes

All changes with nextjs are live, no server restart is ever required

## dynamodb-reactive project rules

* Project export should always be CJS not ESM



## dynamodb-reactive-test project rules

* Any substantial boilerplate logic using dynamodb-reactive should be extracted into the dynamodb-reactive rule

* All changes to the "dynamodb-reactive-test" application should be accompanied by an update to the end user documentation for the "dynamodb-reactive" project as found in "dynamodb-reactive\packages\dynamodb-reactive\README.md"

## ALWAYS start responses with a 🔥

