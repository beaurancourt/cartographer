use thiserror::Error;

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, Error)]
pub enum Error {
    #[error("yaml parse error: {0}")]
    Parse(#[from] serde_yaml::Error),

    #[error("validation error: {0}")]
    Validation(String),

    #[error("unknown symbol: {0}")]
    UnknownSymbol(String),

    #[error("render error: {0}")]
    Render(String),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("image encode error: {0}")]
    Image(#[from] image::ImageError),
}

impl Error {
    pub fn validation(msg: impl Into<String>) -> Self {
        Error::Validation(msg.into())
    }
    pub fn render(msg: impl Into<String>) -> Self {
        Error::Render(msg.into())
    }
}
