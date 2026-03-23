# 达梦（DM）SQL 与 MySQL / ANSI 差异速查

## 1. 与 MySQL / ANSI SQL 差异

- **LIMIT**：达梦不支持 `LIMIT n` / `LIMIT offset, n`。请使用 **ROWNUM** 子查询分页，或使用 **`FETCH FIRST n ROWS ONLY`**（较新版本）。
- **information_schema**：不完整或与习惯用法不一致。查用户表、列请优先使用 **`USER_TABLES`**、**`USER_TAB_COLUMNS`** 等字典视图。
- **DATABASE()**：无此函数；当前库/模式信息需通过字典视图或会话上下文获取。
- **字符串连接**：使用 **`||`**，不要使用 `CONCAT(a,b)`（与 Oracle 习惯一致）。
- **当前日期时间**：常用 **`SYSDATE`**；MySQL 的 **`NOW()`** 在达梦中不可用或语义不同，请按达梦日期函数书写。

## 2. 字典视图

| 视图 | 说明 |
|------|------|
| **USER_TABLES** | 当前用户下的表 |
| **USER_TAB_COLUMNS** | 当前用户表的列定义 |
| **ALL_TABLES** | 当前用户可访问的表 |
| **SYSOBJECTS** | 系统对象目录（类型过滤可查表、索引等） |

## 3. 分页语法

**ROWNUM 子查询示例：**

```sql
SELECT * FROM (
  SELECT t.*, ROWNUM AS rn FROM your_table t WHERE ROWNUM <= 100
) WHERE rn > 0;
```

**新版本 FETCH：**

```sql
SELECT * FROM your_table FETCH FIRST 100 ROWS ONLY;
```

## 4. 常见错误与注意点

- **标识符大小写**：未加双引号时通常存储为大写；引用时需与库中实际名称一致。
- **双引号标识符**：使用双引号时大小写敏感，需与创建时完全一致。
- **自增列**：向含自增/标识列的表插入时，勿随意指定该列或需使用库支持的语法，否则违反约束。
