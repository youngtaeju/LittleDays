// migrations 변경 시 재빌드. migrate! 매크로 임베드 갱신용.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
