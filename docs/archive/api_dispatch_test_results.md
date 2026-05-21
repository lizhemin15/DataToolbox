# @接口制作 端到端测试结果（Qwen3-30B-A3B）

**测试时间**: 2026-05-14
**模型**: Qwen/Qwen3-30B-A3B-Instruct-2507
**数据库ID**: 817397e0-71d5-4b91-8a41-ae47338f2857

---

## 测试用例 1: @接口制作 创建查询订单详情的接口
**状态**: ✅ PASS

**SSE 事件流**:
- `start` → "开始处理您的问题..."
- `thinking` → "正在读取数据库表结构信息..."
- `thinking` → "正在分析您的需求并生成接口配置..."
- `thinking` → "正在执行SQL校验..."
- `api_config_generated` → 完整接口配置

**生成的接口配置**:
| 字段 | 值 |
|------|-----|
| name | 查询订单详情 |
| path | /api/orders/detail |
| method | GET |
| description | 根据订单ID查询订单的详细信息，包括订单基础信息和关联商品信息 |
| sql | SELECT o.ORDER_ID, o.USER_ID, o.PRODUCT_NAME, o.AMOUNT, o.STATUS, o.CREATE_TIME, p.PRODUCT_NAME AS product_name, p.CATEGORY, p.PRICE, p.STOCK, p.DESCRIPTION FROM ORDERS o LEFT JOIN PRODUCTS p ON o.PRODUCT_NAME = p.PRODUCT_NAME WHERE o.ORDER_ID = #{order_id} |
| default_params | {"order_id": 1} |

---

## 测试用例 2: @接口制作 生成产品库存查询API
**状态**: ✅ PASS

**SSE 事件流**:
- `start` → "开始处理您的问题..."
- `thinking` → "正在读取数据库表结构信息..."
- `thinking` → "正在分析您的需求并生成接口配置..."
- `thinking` → "正在执行SQL校验..."
- `api_config_generated` → 完整接口配置

**生成的接口配置**:
| 字段 | 值 |
|------|-----|
| name | 查询产品库存 |
| path | /api/products/inventory |
| method | GET |
| description | 根据最小库存阈值查询库存情况，用于监控低库存商品 |
| sql | SELECT PRODUCT_ID, PRODUCT_NAME, CATEGORY, PRICE, STOCK, DESCRIPTION FROM PRODUCTS WHERE STOCK > #{minStock} ORDER BY STOCK ASC LIMIT #{limit} |
| default_params | {"limit": 20, "minStock": 10} |

---

## 测试用例 3: @接口 制作一个部门员工统计接口
**状态**: ⚠️ FAIL (SQL校验错误，未自动重试成功)

**SSE 事件流**:
- `start` → "开始处理您的问题..."
- `thinking` → "正在读取数据库表结构信息..."
- `thinking` → "正在分析您的需求并生成接口配置..."
- `sql_validation_error` → SQL中引用的字段不存在: employee_count

**错误详情**:
- AI 生成的SQL中使用了 `d.STATUS` 字段，但 HR_DEPARTMENT 表中不存在 STATUS 字段
- 可用字段: HR_DEPARTMENT(DEPT_ID, DEPT_NAME, PARENT_ID, MANAGER_ID, DEPT_LEVEL, CREATE_DATE), HR_EMPLOYEE(EMP_ID, EMP_NAME, GENDER, BIRTH_DATE, HIRE_DATE, DEPT_ID, POSITION, SALARY, PHONE, EMAIL, STATUS)
- 系统提示"已重试3次"但最终仍返回了 sql_validation_error 事件而非 api_config_generated

**AI生成的配置（未通过校验）**:
| 字段 | 值 |
|------|-----|
| name | 部门员工统计接口 |
| path | /api/departments/employee-stat |
| method | GET |
| description | 查询各部门的员工人数、平均薪资、最低薪资和最高薪资统计信息，支持按部门状态过滤 |
| sql | SELECT d.DEPT_ID, d.DEPT_NAME, COUNT(e.EMP_ID) AS employee_count, AVG(e.SALARY) AS avg_salary, MIN(e.SALARY) AS min_salary, MAX(e.SALARY) AS max_salary FROM HR_DEPARTMENT d LEFT JOIN HR_EMPLOYEE e ON d.DEPT_ID = e.DEPT_ID WHERE d.STATUS = #{dept_status} GROUP BY d.DEPT_ID, d.DEPT_NAME ORDER BY employee_count DESC |

**问题根因**: AI在SQL中引用了 `d.STATUS`（HR_DEPARTMENT表无此字段），重试3次后仍未能修正，最终返回 sql_validation_error 而非 api_config_generated。

---

## 总结

| 用例 | 状态 | api_config_generated | 备注 |
|------|------|---------------------|------|
| 查询订单详情 | ✅ PASS | ✅ 有 | 配置完整，SQL正确 |
| 产品库存查询 | ✅ PASS | ✅ 有 | 配置完整，SQL正确 |
| 部门员工统计 | ⚠️ FAIL | ❌ 无 | SQL校验失败，d.STATUS字段不存在 |

**通过率**: 2/3 (66.7%)

**关键发现**:
1. 简单查询（单表/简单JOIN）生成质量高，一次通过
2. 复杂统计查询（GROUP BY + 多表JOIN）容易引用不存在的字段
3. SQL校验重试机制存在但3次重试后仍失败时，未返回 api_config_generated 事件
4. 建议增强重试逻辑：校验失败时将可用字段列表反馈给AI重新生成
