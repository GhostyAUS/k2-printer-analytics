# K2 Analytics Backend

This is the backend component of the K2 Printer Analytics project, built with FastAPI and PostgreSQL.

## Project Structure

- `app/core/` - Configuration and database setup
- `app/models/` - SQLAlchemy models for spool, print_job, and power_log
- `app/api/` - API endpoints
- `app/services/` - Business logic services
- `alembic/` - Database migrations

## Dependencies

The backend uses:
- FastAPI for the web framework
- SQLAlchemy for database ORM
- Alembic for database migrations
- psycopg2-binary for PostgreSQL connectivity
- Pydantic for configuration and data validation

## Configuration

Configuration is handled by Pydantic Settings, with environment variables in `.env` file:

- `DATABASE_URL` - PostgreSQL database connection
- `MOONRAKER_HOST` - Moonraker host IP address (192.168.1.146)
- `MOONRAKER_PORT` - Moonraker port (7125)
- `ELECTRICITY_RATE_KWH` - Power cost in AUD/kWh (0.49)
- `TIMEZONE` - System timezone (Australia/Perth)

## Database

The project uses PostgreSQL with these tables:
- `spools` - Spool information (brand, material, color, weight)
- `print_jobs` - Print job records
- `power_logs` - Power consumption logs