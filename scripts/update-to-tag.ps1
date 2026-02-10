Param(
    [Parameter(Mandatory = $true)]
    [string]$Tag
)

$ErrorActionPreference = "Stop"

# Update to a specific upstream release tag and push to origin.
git fetch upstream --tags
if (-not (git tag -l $Tag)) {
    throw "Tag '$Tag' not found. Run 'git tag -l \"v*\" --sort=-v:refname' to list available release tags."
}
git checkout work/bryson
git reset --hard $Tag
git push --force-with-lease
