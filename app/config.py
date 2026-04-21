from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    database_url: str
    ozon_client_id: str = ""
    ozon_api_key: str = ""
    openai_api_key: str = ""
    admin_token: str = "changeme"
    app_host: str = "0.0.0.0"
    app_port: int = 8200

    class Config:
        env_file = "/root/joywood-gallery/.env"

settings = Settings()
