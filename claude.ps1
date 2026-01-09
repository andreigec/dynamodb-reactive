# Get the location where the script is being executed
$currentDir = Get-Location

Write-Host "--- Launching Claude Code in $currentDir ---" -ForegroundColor Cyan

# Check if 'claude' command exists before running
if (Get-Command "claude" -ErrorAction SilentlyContinue) {
    claude --chrome
} else {
    Write-Error "Claude CLI not found. Please ensure it is installed via npm (npm install -g @anthropic-ai/claude-code)."
    Pause
}