// ===== 关卡数据 =====
const LEVELS = [
    // ===== 第一阶段：基础映射 =====
    {
        id: 1,
        title: '初识 Mapper XML',
        description: '学习 MyBatis Mapper 文件的基本结构',
        tutorial: `
            <p>MyBatis 使用 XML 文件定义 SQL 映射。每个 Mapper XML 文件的根元素是 <code>&lt;mapper&gt;</code>，需要指定 <code>namespace</code> 属性，通常对应 Java Mapper 接口的全限定名。</p>
            <div class="syntax-block">&lt;?xml version="1.0" encoding="UTF-8"?&gt;
&lt;!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "http://mybatis.org/dtd/mybatis-3-mapper.dtd"&gt;

&lt;mapper namespace="com.example.mapper.XxxMapper"&gt;
    &lt;!-- SQL映射语句写在这里 --&gt;
&lt;/mapper&gt;</div>
            <p><code>namespace</code> 必须与对应的 Mapper 接口全限定名一致，这样 MyBatis 才能将接口方法和 XML 中的 SQL 语句关联起来。</p>
        `,
        task: '请编写一个完整的 Mapper XML 骨架，namespace 设为 <code>com.example.mapper.UserMapper</code>，内部暂时为空。',
        hint: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "http://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.example.mapper.UserMapper">

</mapper>`,
        context: `
            <div class="context-label">Mapper 接口：</div>
            <div class="java-block">package com.example.mapper;

public interface UserMapper {
    // 后续会添加方法
}</div>
        `,
        answer: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "http://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.example.mapper.UserMapper">

</mapper>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<\?xml\s+version\s*=\s*"1\.0"/.test(xml),
                msg: '包含 XML 声明 <?xml version="1.0"?>'
            });
            checks.push({
                pass: /<!DOCTYPE\s+mapper/.test(xml),
                msg: '包含 DOCTYPE 声明'
            });
            checks.push({
                pass: /<mapper\s[^>]*namespace\s*=\s*"com\.example\.mapper\.UserMapper"/.test(xml),
                msg: 'mapper 的 namespace 为 com.example.mapper.UserMapper'
            });
            checks.push({
                pass: /<\/mapper\s*>/.test(xml),
                msg: '包含闭合的 </mapper> 标签'
            });
            return checks;
        }
    },
    {
        id: 2,
        title: '基础 select 查询',
        description: '学习编写 select 映射语句',
        tutorial: `
            <p><code>&lt;select&gt;</code> 标签用于定义查询语句。核心属性：</p>
            <div class="syntax-block">&lt;select id="方法名" resultType="返回类型"&gt;
    SELECT * FROM table_name
&lt;/select&gt;</div>
            <p><code>id</code> 对应 Mapper 接口中的方法名。</p>
            <p><code>resultType</code> 指定返回结果的 Java 类型全限定名。</p>
        `,
        task: '请编写一个 <code>&lt;select&gt;</code> 语句，id 为 <code>selectAll</code>，resultType 为 <code>com.example.entity.User</code>，SQL 为查询 user 表的所有数据。',
        hint: `<select id="selectAll" resultType="com.example.entity.User">
    SELECT * FROM user
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; selectAll();</div>
            <div class="context-label">数据库表 user：</div>
            <div class="table-info">id INT PRIMARY KEY
username VARCHAR(50)
email VARCHAR(100)
age INT</div>
        `,
        answer: `<select id="selectAll" resultType="com.example.entity.User">
    SELECT * FROM user
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s/.test(xml),
                msg: '使用 <select> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"selectAll"/.test(xml),
                msg: 'id 属性为 selectAll'
            });
            checks.push({
                pass: /resultType\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'resultType 为 com.example.entity.User'
            });
            checks.push({
                pass: /SELECT\s+\*\s+FROM\s+user/i.test(xml),
                msg: 'SQL 语句为 SELECT * FROM user'
            });
            checks.push({
                pass: /<\/select\s*>/.test(xml),
                msg: '包含闭合的 </select> 标签'
            });
            return checks;
        }
    },
    {
        id: 3,
        title: '参数传递 #{}',
        description: '学习使用 #{} 占位符传递参数',
        tutorial: `
            <p>MyBatis 使用 <code>#{}</code> 作为参数占位符，它会被替换为 <code>?</code> 并使用 PreparedStatement 安全传参：</p>
            <div class="syntax-block">&lt;select id="selectById" resultType="User"
        parameterType="int"&gt;
    SELECT * FROM user WHERE id = #{id}
&lt;/select&gt;</div>
            <p><code>parameterType</code> 指定传入参数的类型（可选但建议写）。</p>
            <p><code>#{id}</code> 会被安全地替换为参数值，可以防止 SQL 注入。</p>
            <p><b>注意：</b><code>#{}</code> 与 <code>\${}</code> 的区别：<code>#{}</code> 是预编译参数（安全），<code>\${}</code> 是字符串拼接（有注入风险）。</p>
        `,
        task: '请编写一个 <code>&lt;select&gt;</code>，id 为 <code>selectById</code>，parameterType 为 <code>int</code>，resultType 为 <code>com.example.entity.User</code>，根据 id 查询单个用户。',
        hint: `<select id="selectById" parameterType="int" resultType="com.example.entity.User">
    SELECT * FROM user WHERE id = #{id}
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">User selectById(int id);</div>
            <div class="context-label">数据库表 user：</div>
            <div class="table-info">id INT PRIMARY KEY
username VARCHAR(50)
email VARCHAR(100)
age INT</div>
        `,
        answer: `<select id="selectById" parameterType="int" resultType="com.example.entity.User">
    SELECT * FROM user WHERE id = #{id}
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s/.test(xml),
                msg: '使用 <select> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"selectById"/.test(xml),
                msg: 'id 属性为 selectById'
            });
            checks.push({
                pass: /parameterType\s*=\s*"int"/.test(xml),
                msg: 'parameterType 为 int'
            });
            checks.push({
                pass: /resultType\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'resultType 为 com.example.entity.User'
            });
            checks.push({
                pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(xml),
                msg: '使用 #{id} 传递参数'
            });
            return checks;
        }
    },
    {
        id: 4,
        title: 'insert 插入数据',
        description: '学习编写 insert 映射语句',
        tutorial: `
            <p><code>&lt;insert&gt;</code> 标签用于定义插入语句：</p>
            <div class="syntax-block">&lt;insert id="insert" parameterType="User"&gt;
    INSERT INTO user (username, email, age)
    VALUES (#{username}, #{email}, #{age})
&lt;/insert&gt;</div>
            <p>当 parameterType 是一个 Java 对象时，<code>#{}</code> 中写的是对象的属性名。</p>
            <p>MyBatis 会自动调用对象的 getter 方法获取值。</p>
        `,
        task: '请编写一个 <code>&lt;insert&gt;</code> 语句，id 为 <code>insertUser</code>，parameterType 为 <code>com.example.entity.User</code>，插入 username、email、age 三个字段。',
        hint: `<insert id="insertUser" parameterType="com.example.entity.User">
    INSERT INTO user (username, email, age)
    VALUES (#{username}, #{email}, #{age})
</insert>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">int insertUser(User user);</div>
            <div class="context-label">User 实体类：</div>
            <div class="java-block">public class User {
    private Integer id;
    private String username;
    private String email;
    private Integer age;
    // getter/setter...
}</div>
        `,
        answer: `<insert id="insertUser" parameterType="com.example.entity.User">
    INSERT INTO user (username, email, age)
    VALUES (#{username}, #{email}, #{age})
</insert>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<insert\s/.test(xml),
                msg: '使用 <insert> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"insertUser"/.test(xml),
                msg: 'id 属性为 insertUser'
            });
            checks.push({
                pass: /parameterType\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'parameterType 为 com.example.entity.User'
            });
            checks.push({
                pass: /INSERT\s+INTO\s+user/i.test(xml),
                msg: 'SQL 包含 INSERT INTO user'
            });
            checks.push({
                pass: /#\{username\}/.test(xml) && /#\{email\}/.test(xml) && /#\{age\}/.test(xml),
                msg: '使用 #{username}、#{email}、#{age} 传递参数'
            });
            checks.push({
                pass: /<\/insert\s*>/.test(xml),
                msg: '包含闭合的 </insert> 标签'
            });
            return checks;
        }
    },
    {
        id: 5,
        title: 'update 更新数据',
        description: '学习编写 update 映射语句',
        tutorial: `
            <p><code>&lt;update&gt;</code> 标签用于定义更新语句：</p>
            <div class="syntax-block">&lt;update id="update" parameterType="User"&gt;
    UPDATE user
    SET username = #{username}, email = #{email}
    WHERE id = #{id}
&lt;/update&gt;</div>
            <p>更新语句一定要注意 <code>WHERE</code> 条件，防止误更新所有数据。</p>
        `,
        task: '请编写一个 <code>&lt;update&gt;</code> 语句，id 为 <code>updateUser</code>，parameterType 为 <code>com.example.entity.User</code>，更新 username、email、age 三个字段，通过 id 定位。',
        hint: `<update id="updateUser" parameterType="com.example.entity.User">
    UPDATE user SET username = #{username}, email = #{email}, age = #{age}
    WHERE id = #{id}
</update>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">int updateUser(User user);</div>
        `,
        answer: `<update id="updateUser" parameterType="com.example.entity.User">
    UPDATE user SET username = #{username}, email = #{email}, age = #{age}
    WHERE id = #{id}
</update>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<update\s/.test(xml),
                msg: '使用 <update> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"updateUser"/.test(xml),
                msg: 'id 属性为 updateUser'
            });
            checks.push({
                pass: /parameterType\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'parameterType 为 com.example.entity.User'
            });
            checks.push({
                pass: /UPDATE\s+user\s+SET/i.test(xml),
                msg: 'SQL 包含 UPDATE user SET'
            });
            checks.push({
                pass: /#\{username\}/.test(xml) && /#\{email\}/.test(xml) && /#\{age\}/.test(xml),
                msg: '使用 #{} 设置 username、email、age'
            });
            checks.push({
                pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(xml),
                msg: '包含 WHERE id = #{id} 条件'
            });
            return checks;
        }
    },
    {
        id: 6,
        title: 'delete 删除数据',
        description: '学习编写 delete 映射语句',
        tutorial: `
            <p><code>&lt;delete&gt;</code> 标签用于定义删除语句：</p>
            <div class="syntax-block">&lt;delete id="deleteById" parameterType="int"&gt;
    DELETE FROM user WHERE id = #{id}
&lt;/delete&gt;</div>
            <p>删除操作同样需要谨慎使用 <code>WHERE</code> 条件。</p>
        `,
        task: '请编写一个 <code>&lt;delete&gt;</code> 语句，id 为 <code>deleteById</code>，parameterType 为 <code>int</code>，根据 id 删除用户。',
        hint: `<delete id="deleteById" parameterType="int">
    DELETE FROM user WHERE id = #{id}
</delete>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">int deleteById(int id);</div>
        `,
        answer: `<delete id="deleteById" parameterType="int">
    DELETE FROM user WHERE id = #{id}
</delete>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<delete\s/.test(xml),
                msg: '使用 <delete> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"deleteById"/.test(xml),
                msg: 'id 属性为 deleteById'
            });
            checks.push({
                pass: /parameterType\s*=\s*"int"/.test(xml),
                msg: 'parameterType 为 int'
            });
            checks.push({
                pass: /DELETE\s+FROM\s+user/i.test(xml),
                msg: 'SQL 包含 DELETE FROM user'
            });
            checks.push({
                pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(xml),
                msg: '使用 #{id} 作为删除条件'
            });
            return checks;
        }
    },
    // ===== 第二阶段：结果映射 =====
    {
        id: 7,
        title: 'resultMap 基础',
        description: '学习用 resultMap 自定义字段映射',
        tutorial: `
            <p>当数据库列名和 Java 属性名不一致时，使用 <code>&lt;resultMap&gt;</code> 进行映射：</p>
            <div class="syntax-block">&lt;resultMap id="userMap" type="com.example.entity.User"&gt;
    &lt;id property="id" column="user_id"/&gt;
    &lt;result property="userName" column="user_name"/&gt;
    &lt;result property="email" column="user_email"/&gt;
&lt;/resultMap&gt;</div>
            <p><code>&lt;id&gt;</code> 映射主键列，<code>&lt;result&gt;</code> 映射普通列。</p>
            <p><code>property</code> 是 Java 属性名，<code>column</code> 是数据库列名。</p>
            <p>使用时将 <code>resultType</code> 替换为 <code>resultMap</code>：</p>
            <div class="syntax-block">&lt;select id="selectAll" resultMap="userMap"&gt;
    SELECT * FROM t_user
&lt;/select&gt;</div>
        `,
        task: '请编写一个 <code>&lt;resultMap&gt;</code>（id 为 <code>userResultMap</code>，type 为 <code>com.example.entity.User</code>），映射下方的数据库列到 Java 属性。然后编写一个使用该 resultMap 的 select 语句（id 为 <code>selectAll</code>）。',
        hint: `<resultMap id="userResultMap" type="com.example.entity.User">
    <id property="id" column="user_id"/>
    <result property="userName" column="user_name"/>
    <result property="userEmail" column="user_email"/>
    <result property="userAge" column="user_age"/>
</resultMap>

<select id="selectAll" resultMap="userResultMap">
    SELECT * FROM t_user
</select>`,
        context: `
            <div class="context-label">Java 属性 → 数据库列 对应关系：</div>
            <div class="table-info">id        → user_id     (主键)
userName   → user_name
userEmail  → user_email
userAge    → user_age</div>
            <div class="context-label">数据库表名：</div>
            <div class="table-info">t_user</div>
        `,
        answer: `<resultMap id="userResultMap" type="com.example.entity.User">
    <id property="id" column="user_id"/>
    <result property="userName" column="user_name"/>
    <result property="userEmail" column="user_email"/>
    <result property="userAge" column="user_age"/>
</resultMap>

<select id="selectAll" resultMap="userResultMap">
    SELECT * FROM t_user
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<resultMap\s/.test(xml),
                msg: '使用 <resultMap> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"userResultMap"/.test(xml),
                msg: 'resultMap 的 id 为 userResultMap'
            });
            checks.push({
                pass: /type\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'type 为 com.example.entity.User'
            });
            checks.push({
                pass: /<id\s[^>]*property\s*=\s*"id"[^>]*column\s*=\s*"user_id"/.test(xml) || /<id\s[^>]*column\s*=\s*"user_id"[^>]*property\s*=\s*"id"/.test(xml),
                msg: '主键映射 id → user_id'
            });
            checks.push({
                pass: /property\s*=\s*"userName"[^>]*column\s*=\s*"user_name"/.test(xml) || /column\s*=\s*"user_name"[^>]*property\s*=\s*"userName"/.test(xml),
                msg: '映射 userName → user_name'
            });
            checks.push({
                pass: /property\s*=\s*"userEmail"[^>]*column\s*=\s*"user_email"/.test(xml) || /column\s*=\s*"user_email"[^>]*property\s*=\s*"userEmail"/.test(xml),
                msg: '映射 userEmail → user_email'
            });
            checks.push({
                pass: /property\s*=\s*"userAge"[^>]*column\s*=\s*"user_age"/.test(xml) || /column\s*=\s*"user_age"[^>]*property\s*=\s*"userAge"/.test(xml),
                msg: '映射 userAge → user_age'
            });
            checks.push({
                pass: /<select\s[^>]*resultMap\s*=\s*"userResultMap"/.test(xml),
                msg: 'select 语句使用 resultMap="userResultMap"'
            });
            return checks;
        }
    },
    {
        id: 8,
        title: '返回自增主键',
        description: '学习 insert 后获取自增主键',
        tutorial: `
            <p>插入数据后，常需要获取数据库自动生成的主键。使用 <code>useGeneratedKeys</code> 和 <code>keyProperty</code>：</p>
            <div class="syntax-block">&lt;insert id="insert" parameterType="User"
        useGeneratedKeys="true" keyProperty="id"&gt;
    INSERT INTO user (username, email)
    VALUES (#{username}, #{email})
&lt;/insert&gt;</div>
            <p><code>useGeneratedKeys="true"</code> 启用自增主键回填。</p>
            <p><code>keyProperty="id"</code> 指定将生成的主键值设置到参数对象的哪个属性上。</p>
            <p>执行后，传入的 User 对象的 id 属性会被自动赋值。</p>
        `,
        task: '请编写一个 <code>&lt;insert&gt;</code> 语句，id 为 <code>insertUser</code>，能回填自增主键到 <code>id</code> 属性，插入 username 和 email。',
        hint: `<insert id="insertUser" parameterType="com.example.entity.User"
        useGeneratedKeys="true" keyProperty="id">
    INSERT INTO user (username, email)
    VALUES (#{username}, #{email})
</insert>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">int insertUser(User user);
// 执行后 user.getId() 即可获取自增ID</div>
        `,
        answer: `<insert id="insertUser" parameterType="com.example.entity.User"
        useGeneratedKeys="true" keyProperty="id">
    INSERT INTO user (username, email)
    VALUES (#{username}, #{email})
</insert>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<insert\s/.test(xml),
                msg: '使用 <insert> 标签'
            });
            checks.push({
                pass: /id\s*=\s*"insertUser"/.test(xml),
                msg: 'id 属性为 insertUser'
            });
            checks.push({
                pass: /useGeneratedKeys\s*=\s*"true"/.test(xml),
                msg: '设置 useGeneratedKeys="true"'
            });
            checks.push({
                pass: /keyProperty\s*=\s*"id"/.test(xml),
                msg: '设置 keyProperty="id"'
            });
            checks.push({
                pass: /#\{username\}/.test(xml) && /#\{email\}/.test(xml),
                msg: '使用 #{username}、#{email} 传参'
            });
            return checks;
        }
    },
    // ===== 第三阶段：动态SQL =====
    {
        id: 9,
        title: 'if 条件判断',
        description: '学习使用 <if> 动态拼接SQL',
        tutorial: `
            <p><code>&lt;if&gt;</code> 根据条件决定是否拼接某段SQL：</p>
            <div class="syntax-block">&lt;select id="search" resultType="User"&gt;
    SELECT * FROM user
    WHERE 1=1
    &lt;if test="username != null"&gt;
        AND username = #{username}
    &lt;/if&gt;
    &lt;if test="email != null"&gt;
        AND email = #{email}
    &lt;/if&gt;
&lt;/select&gt;</div>
            <p><code>test</code> 属性中写 OGNL 表达式（类似Java条件），为 true 时拼接内部SQL。</p>
            <p>常用判断：<code>!= null</code>、<code>!= ''</code>、<code>!= null and != ''</code></p>
        `,
        task: '请编写一个 <code>&lt;select&gt;</code>（id 为 <code>searchUser</code>，resultType 为 <code>com.example.entity.User</code>），支持按 username 和 age 条件查询，两个条件都是可选的（使用 <code>&lt;if&gt;</code> 判断非 null）。',
        hint: `<select id="searchUser" resultType="com.example.entity.User">
    SELECT * FROM user
    WHERE 1=1
    <if test="username != null">
        AND username = #{username}
    </if>
    <if test="age != null">
        AND age = #{age}
    </if>
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; searchUser(
    @Param("username") String username,
    @Param("age") Integer age
);</div>
        `,
        answer: `<select id="searchUser" resultType="com.example.entity.User">
    SELECT * FROM user
    WHERE 1=1
    <if test="username != null">
        AND username = #{username}
    </if>
    <if test="age != null">
        AND age = #{age}
    </if>
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"searchUser"/.test(xml),
                msg: 'select 的 id 为 searchUser'
            });
            checks.push({
                pass: /resultType\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'resultType 为 com.example.entity.User'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"username\s*!=\s*null"/.test(xml),
                msg: '包含 <if test="username != null"> 条件'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"age\s*!=\s*null"/.test(xml),
                msg: '包含 <if test="age != null"> 条件'
            });
            checks.push({
                pass: /#\{username\}/.test(xml) && /#\{age\}/.test(xml),
                msg: '使用 #{username} 和 #{age} 传参'
            });
            return checks;
        }
    },
    {
        id: 10,
        title: 'where 标签',
        description: '学习用 <where> 自动处理 AND/OR',
        tutorial: `
            <p>上一关用 <code>WHERE 1=1</code> 来避免多余的 AND，更优雅的方式是使用 <code>&lt;where&gt;</code> 标签：</p>
            <div class="syntax-block">&lt;select id="search" resultType="User"&gt;
    SELECT * FROM user
    &lt;where&gt;
        &lt;if test="username != null"&gt;
            AND username = #{username}
        &lt;/if&gt;
        &lt;if test="age != null"&gt;
            AND age = #{age}
        &lt;/if&gt;
    &lt;/where&gt;
&lt;/select&gt;</div>
            <p><code>&lt;where&gt;</code> 的作用：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li>至少有一个条件成立时，自动插入 <code>WHERE</code></li>
                <li>自动去除开头多余的 <code>AND</code> 或 <code>OR</code></li>
                <li>所有条件都不成立时，不生成 WHERE 子句</li>
            </ul>
        `,
        task: '请改造第9关的查询，使用 <code>&lt;where&gt;</code> 标签替代 <code>WHERE 1=1</code>。id 为 <code>searchUser</code>，支持 username 和 age 可选条件。',
        hint: `<select id="searchUser" resultType="com.example.entity.User">
    SELECT * FROM user
    <where>
        <if test="username != null">
            AND username = #{username}
        </if>
        <if test="age != null">
            AND age = #{age}
        </if>
    </where>
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; searchUser(
    @Param("username") String username,
    @Param("age") Integer age
);</div>
        `,
        answer: `<select id="searchUser" resultType="com.example.entity.User">
    SELECT * FROM user
    <where>
        <if test="username != null">
            AND username = #{username}
        </if>
        <if test="age != null">
            AND age = #{age}
        </if>
    </where>
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"searchUser"/.test(xml),
                msg: 'select 的 id 为 searchUser'
            });
            checks.push({
                pass: /<where\s*>/.test(xml),
                msg: '使用 <where> 标签'
            });
            checks.push({
                pass: /<\/where\s*>/.test(xml),
                msg: '包含闭合的 </where> 标签'
            });
            checks.push({
                pass: !(/WHERE\s+1\s*=\s*1/i.test(xml)),
                msg: '没有使用 WHERE 1=1（已用 <where> 替代）'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"username\s*!=\s*null"/.test(xml),
                msg: '包含 username 非空判断'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"age\s*!=\s*null"/.test(xml),
                msg: '包含 age 非空判断'
            });
            return checks;
        }
    },
    {
        id: 11,
        title: 'set 标签',
        description: '学习用 <set> 动态更新字段',
        tutorial: `
            <p><code>&lt;set&gt;</code> 标签用于 UPDATE 语句，自动处理多余的逗号：</p>
            <div class="syntax-block">&lt;update id="updateUser" parameterType="User"&gt;
    UPDATE user
    &lt;set&gt;
        &lt;if test="username != null"&gt;
            username = #{username},
        &lt;/if&gt;
        &lt;if test="email != null"&gt;
            email = #{email},
        &lt;/if&gt;
    &lt;/set&gt;
    WHERE id = #{id}
&lt;/update&gt;</div>
            <p><code>&lt;set&gt;</code> 会自动插入 <code>SET</code> 关键字，并去除末尾多余的逗号。</p>
            <p>这样就可以实现"只更新非空字段"的功能。</p>
        `,
        task: '请编写一个动态 <code>&lt;update&gt;</code>（id 为 <code>updateSelective</code>），使用 <code>&lt;set&gt;</code> 标签，只更新传入的非 null 字段（username、email、age），通过 id 定位。',
        hint: `<update id="updateSelective" parameterType="com.example.entity.User">
    UPDATE user
    <set>
        <if test="username != null">
            username = #{username},
        </if>
        <if test="email != null">
            email = #{email},
        </if>
        <if test="age != null">
            age = #{age},
        </if>
    </set>
    WHERE id = #{id}
</update>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">int updateSelective(User user);</div>
        `,
        answer: `<update id="updateSelective" parameterType="com.example.entity.User">
    UPDATE user
    <set>
        <if test="username != null">
            username = #{username},
        </if>
        <if test="email != null">
            email = #{email},
        </if>
        <if test="age != null">
            age = #{age},
        </if>
    </set>
    WHERE id = #{id}
</update>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<update\s[^>]*id\s*=\s*"updateSelective"/.test(xml),
                msg: 'update 的 id 为 updateSelective'
            });
            checks.push({
                pass: /<set\s*>/.test(xml) && /<\/set\s*>/.test(xml),
                msg: '使用 <set> 标签'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"username\s*!=\s*null"/.test(xml),
                msg: '包含 username 非空判断'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"email\s*!=\s*null"/.test(xml),
                msg: '包含 email 非空判断'
            });
            checks.push({
                pass: /<if\s+test\s*=\s*"age\s*!=\s*null"/.test(xml),
                msg: '包含 age 非空判断'
            });
            checks.push({
                pass: /WHERE\s+id\s*=\s*#\{id\}/i.test(xml),
                msg: '包含 WHERE id = #{id}'
            });
            return checks;
        }
    },
    {
        id: 12,
        title: 'choose/when/otherwise',
        description: '学习 MyBatis 的多分支条件',
        tutorial: `
            <p><code>&lt;choose&gt;</code> 类似 Java 的 switch-case，只会选择第一个满足的分支：</p>
            <div class="syntax-block">&lt;select id="search" resultType="User"&gt;
    SELECT * FROM user
    &lt;where&gt;
        &lt;choose&gt;
            &lt;when test="id != null"&gt;
                AND id = #{id}
            &lt;/when&gt;
            &lt;when test="username != null"&gt;
                AND username = #{username}
            &lt;/when&gt;
            &lt;otherwise&gt;
                AND age > 0
            &lt;/otherwise&gt;
        &lt;/choose&gt;
    &lt;/where&gt;
&lt;/select&gt;</div>
            <p>与 <code>&lt;if&gt;</code> 不同，<code>&lt;choose&gt;</code> 只会执行一个分支。</p>
        `,
        task: '请编写一个 <code>&lt;select&gt;</code>（id 为 <code>findUser</code>），使用 <code>&lt;choose&gt;</code>：优先按 id 查询，其次按 username 查询，否则按 email 查询。',
        hint: `<select id="findUser" resultType="com.example.entity.User">
    SELECT * FROM user
    <where>
        <choose>
            <when test="id != null">
                AND id = #{id}
            </when>
            <when test="username != null">
                AND username = #{username}
            </when>
            <otherwise>
                AND email = #{email}
            </otherwise>
        </choose>
    </where>
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">User findUser(
    @Param("id") Integer id,
    @Param("username") String username,
    @Param("email") String email
);</div>
        `,
        answer: `<select id="findUser" resultType="com.example.entity.User">
    SELECT * FROM user
    <where>
        <choose>
            <when test="id != null">
                AND id = #{id}
            </when>
            <when test="username != null">
                AND username = #{username}
            </when>
            <otherwise>
                AND email = #{email}
            </otherwise>
        </choose>
    </where>
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"findUser"/.test(xml),
                msg: 'select 的 id 为 findUser'
            });
            checks.push({
                pass: /<choose\s*>/.test(xml) && /<\/choose\s*>/.test(xml),
                msg: '使用 <choose> 标签'
            });
            checks.push({
                pass: /<when\s+test\s*=\s*"id\s*!=\s*null"/.test(xml),
                msg: '第一个 <when>：id != null'
            });
            checks.push({
                pass: /<when\s+test\s*=\s*"username\s*!=\s*null"/.test(xml),
                msg: '第二个 <when>：username != null'
            });
            checks.push({
                pass: /<otherwise\s*>/.test(xml),
                msg: '包含 <otherwise> 分支'
            });
            checks.push({
                pass: /#\{email\}/.test(xml),
                msg: 'otherwise 分支使用 #{email}'
            });
            return checks;
        }
    },
    {
        id: 13,
        title: 'foreach 遍历集合',
        description: '学习用 foreach 处理 IN 查询',
        tutorial: `
            <p><code>&lt;foreach&gt;</code> 用于遍历集合参数，常用于 IN 查询和批量操作：</p>
            <div class="syntax-block">&lt;select id="selectByIds" resultType="User"&gt;
    SELECT * FROM user
    WHERE id IN
    &lt;foreach collection="ids" item="id"
             open="(" separator="," close=")"&gt;
        #{id}
    &lt;/foreach&gt;
&lt;/select&gt;</div>
            <p>核心属性：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>collection</code> — 要遍历的集合参数名</li>
                <li><code>item</code> — 每次迭代的元素变量名</li>
                <li><code>open</code> — 循环开始前的字符串</li>
                <li><code>close</code> — 循环结束后的字符串</li>
                <li><code>separator</code> — 每次迭代之间的分隔符</li>
            </ul>
        `,
        task: '请编写一个 <code>&lt;select&gt;</code>（id 为 <code>selectByIds</code>），使用 <code>&lt;foreach&gt;</code> 遍历 <code>ids</code> 集合实现 IN 查询。',
        hint: `<select id="selectByIds" resultType="com.example.entity.User">
    SELECT * FROM user
    WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; selectByIds(@Param("ids") List&lt;Integer&gt; ids);</div>
        `,
        answer: `<select id="selectByIds" resultType="com.example.entity.User">
    SELECT * FROM user
    WHERE id IN
    <foreach collection="ids" item="id" open="(" separator="," close=")">
        #{id}
    </foreach>
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"selectByIds"/.test(xml),
                msg: 'select 的 id 为 selectByIds'
            });
            checks.push({
                pass: /<foreach\s/.test(xml),
                msg: '使用 <foreach> 标签'
            });
            checks.push({
                pass: /collection\s*=\s*"ids"/.test(xml),
                msg: 'collection 属性为 ids'
            });
            checks.push({
                pass: /item\s*=\s*"id"/.test(xml),
                msg: 'item 属性为 id'
            });
            checks.push({
                pass: /open\s*=\s*"\("/.test(xml),
                msg: 'open 属性为 ('
            });
            checks.push({
                pass: /separator\s*=\s*","/.test(xml),
                msg: 'separator 属性为 ,'
            });
            checks.push({
                pass: /close\s*=\s*"\)"/.test(xml),
                msg: 'close 属性为 )'
            });
            checks.push({
                pass: /#\{id\}/.test(xml),
                msg: '循环体内使用 #{id}'
            });
            return checks;
        }
    },
    {
        id: 14,
        title: 'foreach 批量插入',
        description: '学习用 foreach 实现批量插入',
        tutorial: `
            <p><code>&lt;foreach&gt;</code> 不仅用于 IN 查询，还可以实现批量插入：</p>
            <div class="syntax-block">&lt;insert id="batchInsert"&gt;
    INSERT INTO user (username, email) VALUES
    &lt;foreach collection="users" item="user"
             separator=","&gt;
        (#{user.username}, #{user.email})
    &lt;/foreach&gt;
&lt;/insert&gt;</div>
            <p>注意访问对象属性时使用 <code>item变量名.属性名</code> 的形式。</p>
            <p>生成的SQL类似：<code>INSERT INTO user (username, email) VALUES ('张三','a@b.com'),('李四','c@d.com')</code></p>
        `,
        task: '请编写一个批量插入语句（id 为 <code>batchInsert</code>），遍历 <code>list</code> 集合，插入 username、email、age 三个字段。',
        hint: `<insert id="batchInsert">
    INSERT INTO user (username, email, age) VALUES
    <foreach collection="list" item="user" separator=",">
        (#{user.username}, #{user.email}, #{user.age})
    </foreach>
</insert>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">int batchInsert(@Param("list") List&lt;User&gt; users);</div>
        `,
        answer: `<insert id="batchInsert">
    INSERT INTO user (username, email, age) VALUES
    <foreach collection="list" item="user" separator=",">
        (#{user.username}, #{user.email}, #{user.age})
    </foreach>
</insert>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<insert\s[^>]*id\s*=\s*"batchInsert"/.test(xml),
                msg: 'insert 的 id 为 batchInsert'
            });
            checks.push({
                pass: /INSERT\s+INTO\s+user/i.test(xml),
                msg: 'SQL 包含 INSERT INTO user'
            });
            checks.push({
                pass: /collection\s*=\s*"list"/.test(xml),
                msg: 'collection 属性为 list'
            });
            checks.push({
                pass: /item\s*=\s*"user"/.test(xml),
                msg: 'item 属性为 user'
            });
            checks.push({
                pass: /separator\s*=\s*","/.test(xml),
                msg: 'separator 属性为 ,'
            });
            checks.push({
                pass: /#\{user\.username\}/.test(xml) && /#\{user\.email\}/.test(xml) && /#\{user\.age\}/.test(xml),
                msg: '使用 #{user.username}、#{user.email}、#{user.age}'
            });
            return checks;
        }
    },
    // ===== 第四阶段：高级特性 =====
    {
        id: 15,
        title: 'sql 片段复用',
        description: '学习用 <sql> 和 <include> 复用SQL片段',
        tutorial: `
            <p><code>&lt;sql&gt;</code> 定义可复用的 SQL 片段，<code>&lt;include&gt;</code> 引用它：</p>
            <div class="syntax-block">&lt;sql id="userColumns"&gt;
    id, username, email, age
&lt;/sql&gt;

&lt;select id="selectAll" resultType="User"&gt;
    SELECT &lt;include refid="userColumns"/&gt;
    FROM user
&lt;/select&gt;

&lt;select id="selectById" resultType="User"&gt;
    SELECT &lt;include refid="userColumns"/&gt;
    FROM user WHERE id = #{id}
&lt;/select&gt;</div>
            <p>避免在多个SQL中重复写列名列表。</p>
        `,
        task: '请定义一个 <code>&lt;sql&gt;</code> 片段（id 为 <code>baseColumns</code>，内容为 <code>id, username, email, age</code>），然后编写两个 select（<code>selectAll</code> 和 <code>selectById</code>）都引用该片段。',
        hint: `<sql id="baseColumns">
    id, username, email, age
</sql>

<select id="selectAll" resultType="com.example.entity.User">
    SELECT <include refid="baseColumns"/> FROM user
</select>

<select id="selectById" parameterType="int" resultType="com.example.entity.User">
    SELECT <include refid="baseColumns"/> FROM user WHERE id = #{id}
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; selectAll();
User selectById(int id);</div>
        `,
        answer: `<sql id="baseColumns">
    id, username, email, age
</sql>

<select id="selectAll" resultType="com.example.entity.User">
    SELECT <include refid="baseColumns"/> FROM user
</select>

<select id="selectById" parameterType="int" resultType="com.example.entity.User">
    SELECT <include refid="baseColumns"/> FROM user WHERE id = #{id}
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<sql\s[^>]*id\s*=\s*"baseColumns"/.test(xml),
                msg: '定义 <sql id="baseColumns"> 片段'
            });
            checks.push({
                pass: (xml.match(/<include\s[^>]*refid\s*=\s*"baseColumns"/g) || []).length >= 2,
                msg: '至少两处引用 <include refid="baseColumns"/>'
            });
            checks.push({
                pass: /id\s*=\s*"selectAll"/.test(xml),
                msg: '包含 selectAll 查询'
            });
            checks.push({
                pass: /id\s*=\s*"selectById"/.test(xml),
                msg: '包含 selectById 查询'
            });
            return checks;
        }
    },
    {
        id: 16,
        title: 'trim 标签',
        description: '学习用 trim 灵活控制SQL拼接',
        tutorial: `
            <p><code>&lt;trim&gt;</code> 是 <code>&lt;where&gt;</code> 和 <code>&lt;set&gt;</code> 的底层实现，更加灵活：</p>
            <div class="syntax-block">&lt;!-- 等价于 &lt;where&gt; --&gt;
&lt;trim prefix="WHERE" prefixOverrides="AND |OR "&gt;
    ...
&lt;/trim&gt;

&lt;!-- 等价于 &lt;set&gt; --&gt;
&lt;trim prefix="SET" suffixOverrides=","&gt;
    ...
&lt;/trim&gt;</div>
            <p>属性说明：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>prefix</code> — 拼接的前缀</li>
                <li><code>suffix</code> — 拼接的后缀</li>
                <li><code>prefixOverrides</code> — 去除内容开头的指定字符</li>
                <li><code>suffixOverrides</code> — 去除内容末尾的指定字符</li>
            </ul>
        `,
        task: '请用 <code>&lt;trim&gt;</code> 标签（而不是 <code>&lt;where&gt;</code>）实现一个条件查询（id 为 <code>searchUser</code>），prefix 为 "WHERE"，prefixOverrides 为 "AND "，支持 username 和 age 可选条件。',
        hint: `<select id="searchUser" resultType="com.example.entity.User">
    SELECT * FROM user
    <trim prefix="WHERE" prefixOverrides="AND ">
        <if test="username != null">
            AND username = #{username}
        </if>
        <if test="age != null">
            AND age = #{age}
        </if>
    </trim>
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; searchUser(
    @Param("username") String username,
    @Param("age") Integer age
);</div>
        `,
        answer: `<select id="searchUser" resultType="com.example.entity.User">
    SELECT * FROM user
    <trim prefix="WHERE" prefixOverrides="AND ">
        <if test="username != null">
            AND username = #{username}
        </if>
        <if test="age != null">
            AND age = #{age}
        </if>
    </trim>
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"searchUser"/.test(xml),
                msg: 'select 的 id 为 searchUser'
            });
            checks.push({
                pass: /<trim\s/.test(xml),
                msg: '使用 <trim> 标签'
            });
            checks.push({
                pass: /prefix\s*=\s*"WHERE"/.test(xml),
                msg: 'prefix 属性为 WHERE'
            });
            checks.push({
                pass: /prefixOverrides\s*=\s*"AND\s?"/.test(xml) || /prefixOverrides\s*=\s*"AND "/.test(xml),
                msg: 'prefixOverrides 包含 AND'
            });
            checks.push({
                pass: !/<where\s*>/.test(xml),
                msg: '没有使用 <where> 标签（使用 <trim> 替代）'
            });
            checks.push({
                pass: /<if\s+test/.test(xml),
                msg: '包含 <if> 条件判断'
            });
            return checks;
        }
    },
    {
        id: 17,
        title: 'association 关联对象',
        description: '学习 resultMap 中的一对一关联映射',
        tutorial: `
            <p>当查询结果包含关联对象（一对一）时，使用 <code>&lt;association&gt;</code>：</p>
            <div class="syntax-block">&lt;resultMap id="orderMap" type="Order"&gt;
    &lt;id property="id" column="order_id"/&gt;
    &lt;result property="orderNo" column="order_no"/&gt;
    &lt;association property="user" javaType="User"&gt;
        &lt;id property="id" column="user_id"/&gt;
        &lt;result property="username" column="username"/&gt;
    &lt;/association&gt;
&lt;/resultMap&gt;</div>
            <p><code>property</code> 是 Java 属性名，<code>javaType</code> 是关联对象的类型。</p>
            <p>对应的 SQL 需要 JOIN 查询来关联两张表。</p>
        `,
        task: '请编写一个 <code>&lt;resultMap&gt;</code>（id 为 <code>orderResultMap</code>，type 为 <code>com.example.entity.Order</code>），映射订单基本字段，并用 <code>&lt;association&gt;</code> 关联用户对象。然后编写一个 select（id 为 <code>selectOrderWithUser</code>）使用 JOIN 查询。',
        hint: `<resultMap id="orderResultMap" type="com.example.entity.Order">
    <id property="id" column="id"/>
    <result property="orderNo" column="order_no"/>
    <result property="amount" column="amount"/>
    <association property="user" javaType="com.example.entity.User">
        <id property="id" column="user_id"/>
        <result property="username" column="username"/>
    </association>
</resultMap>

<select id="selectOrderWithUser" resultMap="orderResultMap">
    SELECT o.id, o.order_no, o.amount, u.id AS user_id, u.username
    FROM orders o
    LEFT JOIN user u ON o.user_id = u.id
    WHERE o.id = #{id}
</select>`,
        context: `
            <div class="context-label">Order 实体类：</div>
            <div class="java-block">public class Order {
    private Integer id;
    private String orderNo;   // → order_no
    private BigDecimal amount;
    private User user;         // 关联用户
}</div>
            <div class="context-label">User 实体类：</div>
            <div class="java-block">public class User {
    private Integer id;
    private String username;
}</div>
        `,
        answer: `<resultMap id="orderResultMap" type="com.example.entity.Order">
    <id property="id" column="id"/>
    <result property="orderNo" column="order_no"/>
    <result property="amount" column="amount"/>
    <association property="user" javaType="com.example.entity.User">
        <id property="id" column="user_id"/>
        <result property="username" column="username"/>
    </association>
</resultMap>

<select id="selectOrderWithUser" resultMap="orderResultMap">
    SELECT o.id, o.order_no, o.amount, u.id AS user_id, u.username
    FROM orders o
    LEFT JOIN user u ON o.user_id = u.id
    WHERE o.id = #{id}
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<resultMap\s[^>]*id\s*=\s*"orderResultMap"/.test(xml),
                msg: 'resultMap 的 id 为 orderResultMap'
            });
            checks.push({
                pass: /<association\s/.test(xml),
                msg: '使用 <association> 标签'
            });
            checks.push({
                pass: /property\s*=\s*"user"/.test(xml),
                msg: 'association 的 property 为 user'
            });
            checks.push({
                pass: /javaType\s*=\s*"com\.example\.entity\.User"/.test(xml),
                msg: 'javaType 为 com.example.entity.User'
            });
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"selectOrderWithUser"/.test(xml),
                msg: '包含 selectOrderWithUser 查询'
            });
            checks.push({
                pass: /resultMap\s*=\s*"orderResultMap"/.test(xml),
                msg: 'select 使用 resultMap="orderResultMap"'
            });
            checks.push({
                pass: /JOIN/i.test(xml),
                msg: 'SQL 包含 JOIN 查询'
            });
            return checks;
        }
    },
    {
        id: 18,
        title: 'collection 集合映射',
        description: '学习 resultMap 中的一对多关联映射',
        tutorial: `
            <p>当查询结果包含集合关联（一对多）时，使用 <code>&lt;collection&gt;</code>：</p>
            <div class="syntax-block">&lt;resultMap id="userWithOrdersMap" type="User"&gt;
    &lt;id property="id" column="id"/&gt;
    &lt;result property="username" column="username"/&gt;
    &lt;collection property="orders"
                ofType="com.example.entity.Order"&gt;
        &lt;id property="id" column="order_id"/&gt;
        &lt;result property="orderNo" column="order_no"/&gt;
    &lt;/collection&gt;
&lt;/resultMap&gt;</div>
            <p><code>ofType</code> 指定集合中元素的类型（注意不是 javaType）。</p>
            <p>一个用户有多个订单，就是一对多关系。</p>
        `,
        task: '请编写一个 <code>&lt;resultMap&gt;</code>（id 为 <code>userWithOrdersMap</code>，type 为 <code>com.example.entity.User</code>），用 <code>&lt;collection&gt;</code> 映射用户的订单列表。然后编写一个 select（id 为 <code>selectUserWithOrders</code>）。',
        hint: `<resultMap id="userWithOrdersMap" type="com.example.entity.User">
    <id property="id" column="id"/>
    <result property="username" column="username"/>
    <result property="email" column="email"/>
    <collection property="orders" ofType="com.example.entity.Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
        <result property="amount" column="amount"/>
    </collection>
</resultMap>

<select id="selectUserWithOrders" resultMap="userWithOrdersMap">
    SELECT u.id, u.username, u.email,
           o.id AS order_id, o.order_no, o.amount
    FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{id}
</select>`,
        context: `
            <div class="context-label">User 实体类：</div>
            <div class="java-block">public class User {
    private Integer id;
    private String username;
    private String email;
    private List&lt;Order&gt; orders;  // 一对多
}</div>
            <div class="context-label">Order 实体类：</div>
            <div class="java-block">public class Order {
    private Integer id;       // → order_id (别名)
    private String orderNo;   // → order_no
    private BigDecimal amount;
}</div>
        `,
        answer: `<resultMap id="userWithOrdersMap" type="com.example.entity.User">
    <id property="id" column="id"/>
    <result property="username" column="username"/>
    <result property="email" column="email"/>
    <collection property="orders" ofType="com.example.entity.Order">
        <id property="id" column="order_id"/>
        <result property="orderNo" column="order_no"/>
        <result property="amount" column="amount"/>
    </collection>
</resultMap>

<select id="selectUserWithOrders" resultMap="userWithOrdersMap">
    SELECT u.id, u.username, u.email,
           o.id AS order_id, o.order_no, o.amount
    FROM user u
    LEFT JOIN orders o ON u.id = o.user_id
    WHERE u.id = #{id}
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<resultMap\s[^>]*id\s*=\s*"userWithOrdersMap"/.test(xml),
                msg: 'resultMap 的 id 为 userWithOrdersMap'
            });
            checks.push({
                pass: /<collection\s/.test(xml),
                msg: '使用 <collection> 标签'
            });
            checks.push({
                pass: /property\s*=\s*"orders"/.test(xml),
                msg: 'collection 的 property 为 orders'
            });
            checks.push({
                pass: /ofType\s*=\s*"com\.example\.entity\.Order"/.test(xml),
                msg: 'ofType 为 com.example.entity.Order'
            });
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"selectUserWithOrders"/.test(xml),
                msg: '包含 selectUserWithOrders 查询'
            });
            checks.push({
                pass: /LEFT\s+JOIN/i.test(xml),
                msg: 'SQL 使用 LEFT JOIN'
            });
            return checks;
        }
    },
    {
        id: 19,
        title: '模糊查询与 bind',
        description: '学习安全地实现模糊查询',
        tutorial: `
            <p>模糊查询中拼接 <code>%</code> 通配符有多种方式：</p>
            <div class="syntax-block">&lt;!-- 方式1：使用 bind 创建变量 --&gt;
&lt;select id="search" resultType="User"&gt;
    &lt;bind name="pattern"
          value="'%' + keyword + '%'"/&gt;
    SELECT * FROM user
    WHERE username LIKE #{pattern}
&lt;/select&gt;

&lt;!-- 方式2：使用 CONCAT 函数 --&gt;
&lt;select id="search" resultType="User"&gt;
    SELECT * FROM user
    WHERE username LIKE CONCAT('%', #{keyword}, '%')
&lt;/select&gt;</div>
            <p><code>&lt;bind&gt;</code> 标签可以创建一个 OGNL 表达式的变量，供后续SQL使用。</p>
            <p><b>注意：</b>不要使用 <code>\${}+%</code> 拼接，有SQL注入风险。</p>
        `,
        task: '请使用 <code>&lt;bind&gt;</code> 标签编写一个模糊查询（id 为 <code>searchByName</code>），将 keyword 参数两侧加上 % 后进行 LIKE 查询。',
        hint: `<select id="searchByName" resultType="com.example.entity.User">
    <bind name="pattern" value="'%' + keyword + '%'"/>
    SELECT * FROM user
    WHERE username LIKE #{pattern}
</select>`,
        context: `
            <div class="context-label">Mapper 接口方法：</div>
            <div class="java-block">List&lt;User&gt; searchByName(
    @Param("keyword") String keyword
);</div>
        `,
        answer: `<select id="searchByName" resultType="com.example.entity.User">
    <bind name="pattern" value="'%' + keyword + '%'"/>
    SELECT * FROM user
    WHERE username LIKE #{pattern}
</select>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"searchByName"/.test(xml),
                msg: 'select 的 id 为 searchByName'
            });
            checks.push({
                pass: /<bind\s/.test(xml),
                msg: '使用 <bind> 标签'
            });
            checks.push({
                pass: /name\s*=\s*"pattern"/.test(xml),
                msg: 'bind 的 name 为 pattern'
            });
            checks.push({
                pass: /value\s*=\s*"'%'\s*\+\s*keyword\s*\+\s*'%'"/.test(xml),
                msg: "bind 的 value 拼接了 % 通配符"
            });
            checks.push({
                pass: /LIKE\s+#\{pattern\}/i.test(xml),
                msg: 'LIKE 使用 #{pattern} 而非 ${}'
            });
            return checks;
        }
    },
    {
        id: 20,
        title: '综合挑战：完整Mapper',
        description: '综合运用所学写一个完整的Mapper文件',
        tutorial: `
            <p>现在综合运用你学到的知识，编写一个完整的 Mapper XML 文件！</p>
            <p>需要包含：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li>XML 声明和 DOCTYPE</li>
                <li>mapper 根标签（含 namespace）</li>
                <li>resultMap 映射</li>
                <li>使用 <code>&lt;where&gt;</code> 和 <code>&lt;if&gt;</code> 的动态查询</li>
                <li>使用 <code>&lt;foreach&gt;</code> 的批量删除</li>
            </ul>
        `,
        task: '请编写一个完整的 Mapper XML，namespace 为 <code>com.example.mapper.ProductMapper</code>，包含：1) resultMap（id 为 productMap）；2) 动态条件查询 searchProducts（使用 where + if）；3) 按 id 列表批量删除 batchDelete（使用 foreach）。',
        hint: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "http://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.example.mapper.ProductMapper">

    <resultMap id="productMap" type="com.example.entity.Product">
        <id property="id" column="product_id"/>
        <result property="productName" column="product_name"/>
        <result property="price" column="price"/>
        <result property="stock" column="stock"/>
    </resultMap>

    <select id="searchProducts" resultMap="productMap">
        SELECT * FROM product
        <where>
            <if test="productName != null">
                AND product_name LIKE CONCAT('%', #{productName}, '%')
            </if>
            <if test="minPrice != null">
                AND price &gt;= #{minPrice}
            </if>
        </where>
    </select>

    <delete id="batchDelete">
        DELETE FROM product WHERE product_id IN
        <foreach collection="ids" item="id" open="(" separator="," close=")">
            #{id}
        </foreach>
    </delete>

</mapper>`,
        context: `
            <div class="context-label">Product 实体类：</div>
            <div class="java-block">public class Product {
    private Integer id;          // → product_id (主键)
    private String productName;  // → product_name
    private BigDecimal price;
    private Integer stock;
}</div>
            <div class="context-label">ProductMapper 接口：</div>
            <div class="java-block">public interface ProductMapper {
    List&lt;Product&gt; searchProducts(
        @Param("productName") String productName,
        @Param("minPrice") BigDecimal minPrice
    );
    int batchDelete(@Param("ids") List&lt;Integer&gt; ids);
}</div>
        `,
        answer: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE mapper PUBLIC "-//mybatis.org//DTD Mapper 3.0//EN"
  "http://mybatis.org/dtd/mybatis-3-mapper.dtd">

<mapper namespace="com.example.mapper.ProductMapper">

    <resultMap id="productMap" type="com.example.entity.Product">
        <id property="id" column="product_id"/>
        <result property="productName" column="product_name"/>
        <result property="price" column="price"/>
        <result property="stock" column="stock"/>
    </resultMap>

    <select id="searchProducts" resultMap="productMap">
        SELECT * FROM product
        <where>
            <if test="productName != null">
                AND product_name LIKE CONCAT('%', #{productName}, '%')
            </if>
            <if test="minPrice != null">
                AND price &gt;= #{minPrice}
            </if>
        </where>
    </select>

    <delete id="batchDelete">
        DELETE FROM product WHERE product_id IN
        <foreach collection="ids" item="id" open="(" separator="," close=")">
            #{id}
        </foreach>
    </delete>

</mapper>`,
        validate(xml) {
            const checks = [];
            checks.push({
                pass: /namespace\s*=\s*"com\.example\.mapper\.ProductMapper"/.test(xml),
                msg: 'namespace 为 com.example.mapper.ProductMapper'
            });
            checks.push({
                pass: /<resultMap\s[^>]*id\s*=\s*"productMap"/.test(xml),
                msg: '定义 resultMap id="productMap"'
            });
            checks.push({
                pass: /type\s*=\s*"com\.example\.entity\.Product"/.test(xml),
                msg: 'resultMap 的 type 为 com.example.entity.Product'
            });
            checks.push({
                pass: /<id\s[^>]*column\s*=\s*"product_id"/.test(xml),
                msg: '主键映射到 product_id'
            });
            checks.push({
                pass: /<select\s[^>]*id\s*=\s*"searchProducts"/.test(xml),
                msg: '包含 searchProducts 查询'
            });
            checks.push({
                pass: /<where\s*>/.test(xml),
                msg: '使用 <where> 标签'
            });
            checks.push({
                pass: /<if\s+test/.test(xml),
                msg: '包含 <if> 条件判断'
            });
            checks.push({
                pass: /<delete\s[^>]*id\s*=\s*"batchDelete"/.test(xml),
                msg: '包含 batchDelete 删除语句'
            });
            checks.push({
                pass: /<foreach\s/.test(xml),
                msg: '使用 <foreach> 进行批量操作'
            });
            checks.push({
                pass: /<\/mapper\s*>/.test(xml),
                msg: '包含闭合的 </mapper>'
            });
            return checks;
        }
    }
];

// ===== 全局状态 =====
let currentLevelIdx = -1;
const STORAGE_KEY = 'mybatis_learn_progress';

function getProgress() {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch { return {}; }
}

function saveProgress(levelId) {
    const p = getProgress();
    p[levelId] = true;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
}

function isLevelCompleted(levelId) {
    return !!getProgress()[levelId];
}

function isLevelUnlocked(idx) {
    if (idx === 0) return true;
    return isLevelCompleted(LEVELS[idx - 1].id);
}

function getCompletedCount() {
    const p = getProgress();
    return LEVELS.filter(l => p[l.id]).length;
}

// ===== UI渲染 =====
function goBack() {
    if (currentLevelIdx >= 0) {
        showLevelSelect();
    } else {
        window.location.href = '../../index.html';
    }
}

function showLevelSelect() {
    currentLevelIdx = -1;
    document.getElementById('levelSelect').style.display = '';
    document.getElementById('levelDetail').style.display = 'none';
    document.getElementById('appInfo').style.display = '';
    renderLevelGrid();
}

function renderLevelGrid() {
    const grid = document.getElementById('levelGrid');
    const completed = getCompletedCount();

    document.getElementById('totalProgress').style.width = (completed / LEVELS.length * 100) + '%';
    document.getElementById('progressText').textContent = `已完成 ${completed} / ${LEVELS.length} 关`;

    grid.innerHTML = LEVELS.map((level, idx) => {
        const done = isLevelCompleted(level.id);
        const unlocked = isLevelUnlocked(idx);
        let cls = 'level-card';
        if (done) cls += ' completed';
        if (!unlocked) cls += ' locked';
        return `
            <div class="${cls}" data-idx="${idx}">
                ${!unlocked ? '<div class="lock-icon">🔒</div>' : ''}
                <div class="level-number">第 ${level.id} 关</div>
                <div class="level-card-title">${level.title}</div>
                <div class="level-card-desc">${level.description}</div>
            </div>
        `;
    }).join('');

    grid.querySelectorAll('.level-card:not(.locked)').forEach(card => {
        card.addEventListener('click', () => {
            openLevel(parseInt(card.dataset.idx));
        });
    });
}

function openLevel(idx) {
    currentLevelIdx = idx;
    const level = LEVELS[idx];

    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = '';
    document.getElementById('appInfo').style.display = 'none';

    document.getElementById('levelTitle').textContent = `第 ${level.id} 关：${level.title}`;
    document.getElementById('tutorialContent').innerHTML = level.tutorial;
    document.getElementById('taskContent').innerHTML = level.task;
    document.getElementById('contextContent').innerHTML = level.context || '';

    // 编辑器和结果重置
    document.getElementById('xmlEditor').value = '';
    document.getElementById('resultArea').innerHTML = '<p class="placeholder-text">编写XML后点击验证查看结果</p>';
    document.getElementById('hintBox').style.display = 'none';
    document.getElementById('expectedSection').style.display = 'none';

    // 导航按钮
    document.getElementById('btnPrevLevel').disabled = (idx === 0);
    const nextUnlocked = idx + 1 < LEVELS.length && isLevelUnlocked(idx + 1);
    document.getElementById('btnNextLevel').disabled = !nextUnlocked;
}

function handleRun() {
    const level = LEVELS[currentLevelIdx];
    const xml = document.getElementById('xmlEditor').value.trim();
    if (!xml) return;

    const resultArea = document.getElementById('resultArea');
    const checks = level.validate(xml);

    const allPass = checks.every(c => c.pass);

    let html = `<ul class="check-list">`;
    checks.forEach(c => {
        const cls = c.pass ? 'pass' : 'fail';
        const icon = c.pass ? '✅' : '❌';
        html += `<li class="${cls}"><span class="check-icon">${icon}</span>${c.msg}</li>`;
    });
    html += `</ul>`;

    if (allPass) {
        resultArea.innerHTML = '<div class="success-msg">✅ 完全正确！所有检查点都通过了。</div>' + html;
        document.getElementById('expectedSection').style.display = 'none';
        saveProgress(level.id);
        showSuccessModal(level);
    } else {
        const passCount = checks.filter(c => c.pass).length;
        resultArea.innerHTML = `<div class="fail-msg">⚠️ 通过 ${passCount}/${checks.length} 项检查，请继续完善。</div>` + html;
        const expectedSection = document.getElementById('expectedSection');
        expectedSection.style.display = '';
        document.getElementById('expectedArea').innerHTML = `<div class="answer-block">${escapeHtml(level.answer)}</div>`;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showSuccessModal(level) {
    const modal = document.getElementById('successModal');
    const idx = LEVELS.indexOf(level);
    const isLast = idx === LEVELS.length - 1;

    document.getElementById('successMsg').textContent = isLast
        ? '你已完成所有关卡，MyBatis XML 映射语法已掌握！'
        : `你已掌握「${level.title}」，继续挑战下一关吧！`;

    document.getElementById('btnNextFromModal').style.display = isLast ? 'none' : '';
    modal.style.display = 'flex';
}

function handleHint() {
    const level = LEVELS[currentLevelIdx];
    const box = document.getElementById('hintBox');
    box.textContent = level.hint;
    box.style.display = box.style.display === 'none' ? '' : 'none';
}

// ===== 事件绑定 =====
document.addEventListener('DOMContentLoaded', () => {
    showLevelSelect();

    document.getElementById('btnRun').addEventListener('click', handleRun);
    document.getElementById('btnHint').addEventListener('click', handleHint);

    document.getElementById('btnPrevLevel').addEventListener('click', () => {
        if (currentLevelIdx > 0) openLevel(currentLevelIdx - 1);
    });

    document.getElementById('btnNextLevel').addEventListener('click', () => {
        if (currentLevelIdx < LEVELS.length - 1 && isLevelUnlocked(currentLevelIdx + 1)) {
            openLevel(currentLevelIdx + 1);
        }
    });

    document.getElementById('btnBackToList').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        showLevelSelect();
    });

    document.getElementById('btnNextFromModal').addEventListener('click', () => {
        document.getElementById('successModal').style.display = 'none';
        if (currentLevelIdx < LEVELS.length - 1) {
            openLevel(currentLevelIdx + 1);
        }
    });

    // Ctrl+Enter 验证
    document.getElementById('xmlEditor').addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleRun();
        }
        // Tab 支持缩进
        if (e.key === 'Tab') {
            e.preventDefault();
            const editor = e.target;
            const start = editor.selectionStart;
            const end = editor.selectionEnd;
            editor.value = editor.value.substring(0, start) + '    ' + editor.value.substring(end);
            editor.selectionStart = editor.selectionEnd = start + 4;
        }
    });
});
