// Tắt JourneyScheduler trong test — các spec gọi runOnce()/tick() tường minh; interval nền
// (20s) sẽ gây flaky khi nhiều e2e boot app trong 1 lượt chạy tuần tự.
process.env.JOURNEY_SCHEDULER_DISABLED = "1";
