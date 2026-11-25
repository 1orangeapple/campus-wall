/* ===========================================================
   霞浦三小校园墙 · 配置文件
   -----------------------------------------------------------
   部署时你只需要改这一个文件：
   把下面两项换成你自己 Supabase 项目的信息
   （Supabase 后台 → Project Settings → API）
   =========================================================== */

window.WALL_CONFIG = {

  // 例：https://abcdefghijklmnop.supabase.co
  SUPABASE_URL: "https://zwkeygyzjtlecfvrwjwk.supabase.co",

  // 例：eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIs...
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inp3a2V5Z3l6anRsZWNmdnJ3andrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2MDA1MzAsImV4cCI6MjExMTE3NjUzMH0.cFu2A34-VoBC4lpRlbZGa5Tn1g3MG3RhdpHn4KVx8RI",

  // 图片存放的 Storage 桶名（在 Supabase 里新建的同名 public bucket）
  STORAGE_BUCKET: "post-images",

  // 站点文案
  SITE_TITLE: "霞浦三小校园墙",
  SITE_SLOGAN: "把想说的话，轻轻放在这里",

  // 单条帖子最多几张图（当前版本 1 张，改这里前端会自动适配）
  MAX_IMAGES: 1
};
