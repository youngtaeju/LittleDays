#[derive(utoipa::OpenApi)]
#[openapi(info(title = "LittleDays API"))]
pub struct ApiDoc;

/// 바이너리 본문 문서 전용 스키마. `type: string, format: binary`.
pub struct BinaryBody;

impl utoipa::PartialSchema for BinaryBody {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::ObjectBuilder::new()
            .schema_type(utoipa::openapi::schema::SchemaType::Type(
                utoipa::openapi::schema::Type::String,
            ))
            .format(Some(utoipa::openapi::schema::SchemaFormat::KnownFormat(
                utoipa::openapi::schema::KnownFormat::Binary,
            )))
            .into()
    }
}

impl utoipa::ToSchema for BinaryBody {}
