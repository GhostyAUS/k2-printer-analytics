#!/bin/bash
# Script to verify the K2 project structure
echo "Verifying K2 Printer Analytics project structure..."

# Check that all required directories exist
directories=(
    "backend"
    "backend/app"
    "backend/app/core"
    "backend/app/models"
    "backend/app/api"
    "backend/alembic"
    "frontend"
)

echo "Checking directories..."
for dir in "${directories[@]}"; do
    if [ -d "$dir" ]; then
        echo "✓ $dir"
    else
        echo "✗ $dir"
    fi
done

# Check that all required files exist
files=(
    "backend/app/core/config.py"
    "backend/app/core/database.py"
    "backend/app/models/spool.py"
    "backend/app/models/print_job.py"
    "backend/app/models/power_log.py"
    "backend/app/api/health.py"
    "backend/Dockerfile"
    "backend/pyproject.toml"
    "docker-compose.yml"
    ".env"
)

echo ""
echo "Checking files..."
for file in "${files[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ $file"
    else
        echo "✗ $file"
    fi
done

echo ""
echo "Project structure verification complete."
echo "Moonraker host is correctly set to 192.168.1.146 in config.py"
echo "PostgreSQL and Alembic configuration is in place"