-- 대표 사진 정사각 자르기 영역. 원본 비율 기준 정규화 값 {x, y, size}.
ALTER TABLE babies ADD COLUMN avatar_crop jsonb;

-- avatar_asset_id 가 NULL 이 되면(휴지통 이동, 영구 삭제 FK SET NULL, PUT 에서 null) 자르기도 초기화.
-- 다른 자산으로 교체할 때는 클라이언트가 새 자르기 또는 null 을 전체 PUT 으로 전달.
CREATE FUNCTION babies_clear_avatar_crop() RETURNS trigger AS $$
BEGIN
  NEW.avatar_crop := NULL;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER babies_clear_avatar_crop
  BEFORE UPDATE ON babies
  FOR EACH ROW WHEN (NEW.avatar_asset_id IS NULL)
  EXECUTE FUNCTION babies_clear_avatar_crop();
