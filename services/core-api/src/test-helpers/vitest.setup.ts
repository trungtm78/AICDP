// Tắt JourneyScheduler trong test — các spec gọi runOnce()/tick() tường minh; interval nền
// (20s) sẽ gây flaky khi nhiều e2e boot app trong 1 lượt chạy tuần tự.
process.env.JOURNEY_SCHEDULER_DISABLED = "1";
process.env.LOYALTY_EXPIRY_SCHEDULER_DISABLED = "1";
process.env.LOYALTY_EARN_SCHEDULER_DISABLED = "1";
