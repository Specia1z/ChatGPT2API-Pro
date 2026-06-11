// 创作页常量：尺寸预设分组、筛选标签、动画 variants。
import { Square, Monitor, Smartphone, Camera, Filter, CheckCircle, Clock, AlertCircle } from "lucide-react";

export type SizePreset = { id: string; label: string; ratio: string; icon: any; desc: string };
export type SizeGroup = { group: string; icon: any; items: SizePreset[] };

/* ── Size presets ──────────────────────
   上游 gpt-image 只认「比例」，不认「分辨率」——总像素恒定 ~1.5MP，按比例分配长宽。
   故所有档位本质是比例；id 仍传比例字符串给后端（契约不变）。
   label=场景/平台（用户视角），ratio=底层比例（也是传后端的 id）。
   分组展示：点开某组才平铺该组预设，避免一屏堆几十个。 */
export const SIZE_GROUPS: SizeGroup[] = [
  {
    group: "社交媒体", icon: Smartphone, items: [
      { id: "1:1",  label: "方形",       ratio: "1:1",  icon: Square,     desc: "IG 方图 / 头像 / 微博" },
      { id: "3:4",  label: "小红书",     ratio: "3:4",  icon: Smartphone, desc: "小红书 / 竖版封面" },
      { id: "4:5",  label: "朋友圈/IG",  ratio: "4:5",  icon: Smartphone, desc: "朋友圈 / Instagram 竖图" },
      { id: "9:16", label: "短视频竖屏", ratio: "9:16", icon: Smartphone, desc: "抖音 / 快手 / Reels / Shorts" },
      { id: "16:9", label: "视频封面",   ratio: "16:9", icon: Monitor,    desc: "B站 / YouTube 封面" },
      { id: "10:16",label: "竖版海报",   ratio: "10:16",icon: Smartphone, desc: "长图文 / 活动海报" },
    ],
  },
  {
    group: "电商", icon: Camera, items: [
      { id: "1:1",  label: "商品主图",   ratio: "1:1",  icon: Square,     desc: "淘宝/京东 主图方版" },
      { id: "3:4",  label: "详情竖图",   ratio: "3:4",  icon: Smartphone, desc: "详情页 / 服饰展示" },
      { id: "2:3",  label: "商品长图",   ratio: "2:3",  icon: Camera,     desc: "海报 / 竖版宣传" },
      { id: "16:9", label: "Banner",     ratio: "16:9", icon: Monitor,    desc: "店铺横幅 / 轮播图" },
      { id: "4:3",  label: "通用横版",   ratio: "4:3",  icon: Monitor,    desc: "通用展示横版" },
    ],
  },
  {
    group: "壁纸 / 屏幕", icon: Monitor, items: [
      { id: "9:16", label: "手机壁纸",   ratio: "9:16", icon: Smartphone, desc: "手机全屏壁纸" },
      { id: "16:9", label: "电脑壁纸",   ratio: "16:9", icon: Monitor,    desc: "桌面 / 显示器壁纸" },
      { id: "16:10",label: "宽屏壁纸",   ratio: "16:10",icon: Monitor,    desc: "MacBook / 宽屏笔记本" },
      { id: "21:9", label: "带鱼屏",     ratio: "21:9", icon: Monitor,    desc: "超宽显示器 / 影视感" },
      { id: "9:21", label: "超长竖屏",   ratio: "9:21", icon: Smartphone, desc: "信息流长图 / 锁屏" },
    ],
  },
  {
    group: "摄影 / 经典", icon: Camera, items: [
      { id: "3:2",  label: "横版照片",   ratio: "3:2",  icon: Camera,     desc: "单反横拍 / 风光" },
      { id: "2:3",  label: "竖版照片",   ratio: "2:3",  icon: Camera,     desc: "单反竖拍 / 人像" },
      { id: "4:3",  label: "标准",       ratio: "4:3",  icon: Monitor,    desc: "经典 4:3 横构图" },
      { id: "5:4",  label: "经典框",     ratio: "5:4",  icon: Camera,     desc: "近正方横幅" },
      { id: "1:1",  label: "方画幅",     ratio: "1:1",  icon: Square,     desc: "中画幅 / 方构图" },
    ],
  },
];

export const FILTER_TABS = [
  { key: "all" as const, label: "全部", icon: Filter },
  { key: "completed" as const, label: "已完成", icon: CheckCircle },
  { key: "pending" as const, label: "生成中", icon: Clock },
  { key: "failed" as const, label: "失败", icon: AlertCircle },
];

// 统一动画 variants
export const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.05 } } };
export const fadeUp = { hidden: { opacity: 0, y: 14 }, visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] as const } } };
