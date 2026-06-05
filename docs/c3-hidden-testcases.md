# C3 hidden testcase branch

This branch keeps the current frontend-only contest platform behavior and adds
the hidden testcase policy for imported problems.

## Policy

- C1 and C2 remain public.
- C3 and later cases are marked `hidden`.
- Hidden cases still run during formal grading.
- Hidden case inputs, expected outputs, and actual outputs are not shown in the
  student result panel.
- If an imported problem has `test_cases`, the importer uses those cases.
- If an imported problem has only `examples`, the importer converts examples
  into C1, C2, C3... and hides C3 and later.

## Source Data Note

The local `bdesigner_114_problems.json` file contains 102 problems.
With the available source data:

- 28 problems already have C3 or later data.
- 74 problems do not contain a distinct C3 in the source JSON.
- 5 problems have no executable testcase/example data in the source JSON.

For problems with only two source cases, this branch does not invent C3 answers.
Those cases should be added by editing/importing JSON or CSV so formal grading
does not reject correct student solutions with an incorrect hidden answer.
