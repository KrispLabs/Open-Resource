from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./hireai.db"
    jwt_secret: str = "dev-secret-change-in-prod"
    jwt_expire_days: int = 7
    hr_email: str = "hr@openresource.com"
    hr_password: str = "demo1234"
    dev_email: str = "admin@openresource.com"
    dev_password: str = "demo1234"
    upload_dir: str = "uploads"
    frontend_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:5175"
    featherlessai_api_key: str = ""
    brightdata_api_key: str = ""
    brightdata_dataset_id: str = "gd_m794s4jrlq1bvkfnt"  # Bright Data GitHub profiles dataset ID


settings = Settings()
