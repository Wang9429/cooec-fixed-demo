提交本轮 main（Pages 构建时写入 r32-build.json）
口径自检 npm run verify 382/382
覆盖 资金 11/11、产权 10/10，已启用官方子场景 23 条（未批量启用 80）
场景详情业务化：中文核验表、持股分行来源、专业核查材料与结论

R3.2 详情业务化截图（须打开核验表/专业核查/持股，不能只截清单）：
- r32_s039_payment_basis.png S039 该笔批准800、实付1200、超出400、上限2000
- r32_s039_clear_basis.png S039 正常付款4200=4200未命中
- r32_s039_hit_basis_entry.png S039 关联事项办理入口
- r32_s037_proceeds_basis.png S037 应收800、到账480、未收320
- r32_s011_professional_review.png S011 材料/要点/责任人/结论，待核查
- r32_s011_scenario_detail.png S011 场景详情五段结构
- r32_s032_governance_review.png S032 治理核查
- r32_s032_scenario_detail.png S032 场景详情
- r32_holdings_60_60_55.png 被投企业A 持股60/60/55分行来源基准日
- r32_overview_entry.png 综合总览统一入口

R3.2 覆盖对照截图：
- r32_funds_executable_11.png 资金全部专题可执行一级（无未启用行）
- r32_funds_s039_objects.png S039 对象清单含 P-PAY001
- r32_rights_trade_flow.png 产权交易：经济行为+肩形流程+场景同框
- r32_rights_registration.png 产权登记：无经济行为、无流程
- r32_rights_identity.png 标识与名称资质
- r32_rights_all_10.png 全部场景（10）
- r32_rights_s037_hit.png S037 命中对象 PTY-M002
- r32_rights_s011_review.png S011 专业核查事项
- r32_settings_catalog.png 系统配置完整目录
- coverage-r32.json / coverage-r32.md 21 项实际覆盖
- r32-build.json Pages 实际部署提交
