// ===== 关卡数据 =====
const LEVELS = [
    {
        id: 1,
        title: 'Hello World',
        description: '你的第一个Go程序',
        tutorial: `
            <p>每个Go程序都从 <code>package main</code> 开始，这是程序的入口包。</p>
            <p><code>import</code> 语句用于引入需要的包，<code>fmt</code> 包提供了格式化输入输出的功能。</p>
            <p><code>func main()</code> 是程序的入口函数，程序从这里开始执行。</p>
            <div class="syntax-block">package main<br><br>import "fmt"<br><br>func main() {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println("Hello, World!")<br>}</div>
            <p><code>fmt.Println()</code> 用于在控制台输出一行文本。</p>
        `,
        task: '编写一个程序，输出 <code>Hello, Go!</code>',
        hint: '使用 fmt.Println("Hello, Go!") 输出文本。',
        example: `package main

import "fmt"

func main() {
    fmt.Println("Hello, World!")
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 在这里编写代码
}`,
        expectedOutput: 'Hello, Go!\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 2,
        title: '变量声明',
        description: '学习如何声明和使用变量',
        tutorial: `
            <p>Go语言中有多种声明变量的方式：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>var name string = "Go"</code> - 完整声明</li>
                <li><code>var name = "Go"</code> - 类型推断</li>
                <li><code>name := "Go"</code> - 短变量声明（只能在函数内使用）</li>
            </ul>
            <p>基本数据类型包括：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>int</code> - 整数</li>
                <li><code>float64</code> - 浮点数</li>
                <li><code>string</code> - 字符串</li>
                <li><code>bool</code> - 布尔值（true/false）</li>
            </ul>
        `,
        task: '声明一个字符串变量 <code>name</code>，值为 <code>"Gopher"</code>，并输出 <code>My name is Gopher</code>',
        hint: '使用 name := "Gopher"，然后用 fmt.Println() 输出。',
        example: `package main

import "fmt"

func main() {
    age := 25
    fmt.Println("I am", age, "years old")
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 声明变量并输出
}`,
        expectedOutput: 'My name is Gopher\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 3,
        title: '基本运算',
        description: '学习算术运算',
        tutorial: `
            <p>Go语言支持常见的算术运算符：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>+</code> 加法</li>
                <li><code>-</code> 减法</li>
                <li><code>*</code> 乘法</li>
                <li><code>/</code> 除法</li>
                <li><code>%</code> 取余</li>
            </ul>
            <p>示例：</p>
            <div class="syntax-block">result := 10 + 5  // 15<br>remainder := 10 % 3  // 1</div>
        `,
        task: '计算两个数字 23 和 45 的和，并输出结果',
        hint: '使用 sum := 23 + 45，然后输出 sum',
        example: `package main

import "fmt"

func main() {
    a := 10
    b := 3
    result := a * b
    fmt.Println(result)
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 计算并输出结果
}`,
        expectedOutput: '68\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 4,
        title: '条件语句 if',
        description: '学习使用if条件判断',
        tutorial: `
            <p><code>if</code> 语句用于条件判断：</p>
            <div class="syntax-block">if 条件 {<br>&nbsp;&nbsp;&nbsp;&nbsp;// 条件为真时执行<br>} else {<br>&nbsp;&nbsp;&nbsp;&nbsp;// 条件为假时执行<br>}</div>
            <p>比较运算符：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>==</code> 等于</li>
                <li><code>!=</code> 不等于</li>
                <li><code>&gt;</code> 大于</li>
                <li><code>&lt;</code> 小于</li>
                <li><code>&gt;=</code> 大于等于</li>
                <li><code>&lt;=</code> 小于等于</li>
            </ul>
        `,
        task: '判断数字 18 是否大于等于 18，如果是输出 <code>Adult</code>，否则输出 <code>Minor</code>',
        hint: '使用 if age >= 18 判断',
        example: `package main

import "fmt"

func main() {
    score := 85
    if score >= 60 {
        fmt.Println("Pass")
    } else {
        fmt.Println("Fail")
    }
}`,
        initialCode: `package main

import "fmt"

func main() {
    age := 18
    // 在这里添加条件判断
}`,
        expectedOutput: 'Adult\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 5,
        title: 'for 循环',
        description: '学习使用for循环',
        tutorial: `
            <p>Go语言只有 <code>for</code> 循环，但它可以实现多种循环方式：</p>
            <p>基本for循环：</p>
            <div class="syntax-block">for i := 0; i &lt; 5; i++ {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println(i)<br>}</div>
            <p>while风格循环：</p>
            <div class="syntax-block">i := 0<br>for i &lt; 5 {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println(i)<br>&nbsp;&nbsp;&nbsp;&nbsp;i++<br>}</div>
            <p>无限循环：</p>
            <div class="syntax-block">for {<br>&nbsp;&nbsp;&nbsp;&nbsp;// 循环体<br>}</div>
        `,
        task: '使用for循环输出数字 1 到 5（每个数字占一行）',
        hint: '使用 for i := 1; i <= 5; i++ 循环',
        example: `package main

import "fmt"

func main() {
    for i := 0; i < 3; i++ {
        fmt.Println("Count:", i)
    }
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 在这里编写循环
}`,
        expectedOutput: '1\n2\n3\n4\n5\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 6,
        title: '函数定义',
        description: '学习如何定义和调用函数',
        tutorial: `
            <p>函数使用 <code>func</code> 关键字定义：</p>
            <div class="syntax-block">func 函数名(参数列表) 返回类型 {<br>&nbsp;&nbsp;&nbsp;&nbsp;// 函数体<br>&nbsp;&nbsp;&nbsp;&nbsp;return 返回值<br>}</div>
            <p>示例：</p>
            <div class="syntax-block">func add(a int, b int) int {<br>&nbsp;&nbsp;&nbsp;&nbsp;return a + b<br>}<br><br>result := add(3, 5)  // 8</div>
            <p>多返回值：</p>
            <div class="syntax-block">func swap(a, b int) (int, int) {<br>&nbsp;&nbsp;&nbsp;&nbsp;return b, a<br>}</div>
        `,
        task: '定义一个函数 <code>multiply</code>，接收两个整数参数，返回它们的乘积。然后调用该函数计算 6 * 7 并输出结果',
        hint: '定义 func multiply(a int, b int) int { return a * b }',
        example: `package main

import "fmt"

func greet(name string) string {
    return "Hello, " + name
}

func main() {
    msg := greet("Go")
    fmt.Println(msg)
}`,
        initialCode: `package main

import "fmt"

// 在这里定义 multiply 函数

func main() {
    // 调用函数并输出结果
}`,
        expectedOutput: '42\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 7,
        title: '数组',
        description: '学习数组的使用',
        tutorial: `
            <p>数组是固定长度的相同类型元素序列：</p>
            <div class="syntax-block">var arr [5]int  // 声明长度为5的整数数组<br>arr[0] = 10  // 设置第一个元素<br>value := arr[0]  // 读取第一个元素</div>
            <p>数组字面量：</p>
            <div class="syntax-block">arr := [3]string{"Go", "Python", "Java"}</div>
            <p>获取数组长度：</p>
            <div class="syntax-block">length := len(arr)</div>
        `,
        task: '创建一个包含数字 10, 20, 30, 40, 50 的整数数组，并输出数组的第三个元素（30）',
        hint: '使用 arr := [5]int{10, 20, 30, 40, 50}，然后输出 arr[2]',
        example: `package main

import "fmt"

func main() {
    fruits := [3]string{"apple", "banana", "orange"}
    fmt.Println(fruits[1])
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 创建数组并输出第三个元素
}`,
        expectedOutput: '30\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 8,
        title: '切片 Slice',
        description: '学习切片的使用',
        tutorial: `
            <p>切片是动态数组，比数组更灵活：</p>
            <div class="syntax-block">var s []int  // 声明切片<br>s = []int{1, 2, 3}  // 初始化切片</div>
            <p>使用 <code>make</code> 创建切片：</p>
            <div class="syntax-block">s := make([]int, 5)  // 长度为5的切片</div>
            <p>添加元素：</p>
            <div class="syntax-block">s = append(s, 4)  // 添加元素4</div>
            <p>切片操作：</p>
            <div class="syntax-block">arr := []int{1, 2, 3, 4, 5}<br>sub := arr[1:3]  // [2, 3]</div>
        `,
        task: '创建一个切片包含 1, 2, 3，然后使用 append 添加数字 4 和 5，最后输出切片的长度',
        hint: '使用 s := []int{1, 2, 3}，然后 s = append(s, 4, 5)，输出 len(s)',
        example: `package main

import "fmt"

func main() {
    nums := []int{10, 20}
    nums = append(nums, 30)
    fmt.Println(len(nums))
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 创建切片、添加元素并输出长度
}`,
        expectedOutput: '5\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 9,
        title: 'Map 映射',
        description: '学习map的使用',
        tutorial: `
            <p>Map是键值对的集合（类似其他语言的字典/哈希表）：</p>
            <div class="syntax-block">var m map[string]int  // 声明map<br>m = make(map[string]int)  // 初始化<br>m["age"] = 25  // 设置键值对</div>
            <p>字面量初始化：</p>
            <div class="syntax-block">m := map[string]int{<br>&nbsp;&nbsp;&nbsp;&nbsp;"age": 25,<br>&nbsp;&nbsp;&nbsp;&nbsp;"score": 90,<br>}</div>
            <p>读取和删除：</p>
            <div class="syntax-block">value := m["age"]  // 读取<br>delete(m, "age")  // 删除</div>
        `,
        task: '创建一个map，键为字符串，值为整数。添加键值对 <code>"Go": 2009</code>（Go的发布年份），然后输出该值',
        hint: '使用 m := make(map[string]int)，然后 m["Go"] = 2009，输出 m["Go"]',
        example: `package main

import "fmt"

func main() {
    scores := map[string]int{
        "Alice": 95,
        "Bob": 87,
    }
    fmt.Println(scores["Alice"])
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 创建map并输出值
}`,
        expectedOutput: '2009\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 10,
        title: '结构体 Struct',
        description: '学习结构体的定义和使用',
        tutorial: `
            <p>结构体是字段的集合，用于组织相关数据：</p>
            <div class="syntax-block">type Person struct {<br>&nbsp;&nbsp;&nbsp;&nbsp;Name string<br>&nbsp;&nbsp;&nbsp;&nbsp;Age  int<br>}</div>
            <p>创建结构体实例：</p>
            <div class="syntax-block">p := Person{Name: "Alice", Age: 25}<br>// 或<br>p := Person{"Alice", 25}</div>
            <p>访问字段：</p>
            <div class="syntax-block">fmt.Println(p.Name)  // Alice<br>p.Age = 26  // 修改字段</div>
        `,
        task: '定义一个 <code>Book</code> 结构体，包含 <code>Title</code>（字符串）和 <code>Pages</code>（整数）两个字段。创建一个书籍实例，标题为 <code>"The Go Programming Language"</code>，页数为 <code>380</code>，然后输出书籍标题',
        hint: '定义 type Book struct { Title string; Pages int }，然后创建实例',
        example: `package main

import "fmt"

type Car struct {
    Brand string
    Year  int
}

func main() {
    c := Car{Brand: "Toyota", Year: 2020}
    fmt.Println(c.Brand)
}`,
        initialCode: `package main

import "fmt"

// 在这里定义 Book 结构体

func main() {
    // 创建实例并输出标题
}`,
        expectedOutput: 'The Go Programming Language\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 11,
        title: '方法',
        description: '学习为结构体定义方法',
        tutorial: `
            <p>方法是与特定类型关联的函数：</p>
            <div class="syntax-block">type Rectangle struct {<br>&nbsp;&nbsp;&nbsp;&nbsp;Width, Height int<br>}<br><br>func (r Rectangle) Area() int {<br>&nbsp;&nbsp;&nbsp;&nbsp;return r.Width * r.Height<br>}</div>
            <p>调用方法：</p>
            <div class="syntax-block">rect := Rectangle{Width: 10, Height: 5}<br>area := rect.Area()  // 50</div>
            <p>指针接收者（可修改结构体）：</p>
            <div class="syntax-block">func (r *Rectangle) Scale(factor int) {<br>&nbsp;&nbsp;&nbsp;&nbsp;r.Width *= factor<br>&nbsp;&nbsp;&nbsp;&nbsp;r.Height *= factor<br>}</div>
        `,
        task: '为 <code>Circle</code> 结构体（包含 <code>Radius int</code> 字段）定义一个方法 <code>Diameter()</code>，返回直径（半径的2倍）。创建一个半径为 5 的圆，调用方法并输出直径',
        hint: 'func (c Circle) Diameter() int { return c.Radius * 2 }',
        example: `package main

import "fmt"

type Square struct {
    Side int
}

func (s Square) Perimeter() int {
    return s.Side * 4
}

func main() {
    sq := Square{Side: 6}
    fmt.Println(sq.Perimeter())
}`,
        initialCode: `package main

import "fmt"

type Circle struct {
    Radius int
}

// 在这里为 Circle 定义 Diameter 方法

func main() {
    // 创建实例、调用方法并输出
}`,
        expectedOutput: '10\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 12,
        title: '接口 Interface',
        description: '学习接口的定义和实现',
        tutorial: `
            <p>接口定义了一组方法签名：</p>
            <div class="syntax-block">type Shape interface {<br>&nbsp;&nbsp;&nbsp;&nbsp;Area() float64<br>}</div>
            <p>任何类型只要实现了接口的所有方法，就自动实现了该接口（隐式实现）：</p>
            <div class="syntax-block">type Circle struct {<br>&nbsp;&nbsp;&nbsp;&nbsp;Radius float64<br>}<br><br>func (c Circle) Area() float64 {<br>&nbsp;&nbsp;&nbsp;&nbsp;return 3.14 * c.Radius * c.Radius<br>}</div>
            <p>接口变量可以存储任何实现了该接口的类型：</p>
            <div class="syntax-block">var s Shape = Circle{Radius: 5}<br>area := s.Area()</div>
        `,
        task: '定义一个 <code>Speaker</code> 接口，包含方法 <code>Speak() string</code>。定义 <code>Dog</code> 结构体实现该接口，<code>Speak</code> 方法返回 <code>"Woof!"</code>。创建一个 Dog 实例，调用 Speak 方法并输出',
        hint: 'type Speaker interface { Speak() string }',
        example: `package main

import "fmt"

type Greeter interface {
    Greet() string
}

type Person struct {
    Name string
}

func (p Person) Greet() string {
    return "Hello, " + p.Name
}

func main() {
    var g Greeter = Person{Name: "Go"}
    fmt.Println(g.Greet())
}`,
        initialCode: `package main

import "fmt"

// 定义 Speaker 接口

// 定义 Dog 结构体并实现接口

func main() {
    // 创建实例并调用方法
}`,
        expectedOutput: 'Woof!\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 13,
        title: '错误处理',
        description: '学习Go的错误处理机制',
        tutorial: `
            <p>Go使用返回值来处理错误，而不是异常：</p>
            <div class="syntax-block">func divide(a, b int) (int, error) {<br>&nbsp;&nbsp;&nbsp;&nbsp;if b == 0 {<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;return 0, errors.New("division by zero")<br>&nbsp;&nbsp;&nbsp;&nbsp;}<br>&nbsp;&nbsp;&nbsp;&nbsp;return a / b, nil<br>}</div>
            <p>检查错误：</p>
            <div class="syntax-block">result, err := divide(10, 0)<br>if err != nil {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println("Error:", err)<br>} else {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println("Result:", result)<br>}</div>
            <p><code>nil</code> 表示没有错误。</p>
        `,
        task: '定义一个函数 <code>sqrt</code>，接收一个整数，如果该数为负数则返回错误 <code>"negative number"</code>，否则返回该数（作为简化，不计算真实平方根）。调用 sqrt(16) 并输出结果',
        hint: 'import "errors" 然后 if n < 0 { return 0, errors.New("negative number") }',
        example: `package main

import (
    "errors"
    "fmt"
)

func checkAge(age int) error {
    if age < 18 {
        return errors.New("too young")
    }
    return nil
}

func main() {
    err := checkAge(20)
    if err != nil {
        fmt.Println(err)
    } else {
        fmt.Println("OK")
    }
}`,
        initialCode: `package main

import (
    "errors"
    "fmt"
)

// 定义 sqrt 函数

func main() {
    // 调用 sqrt(16) 并输出结果
}`,
        expectedOutput: '16\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 14,
        title: 'Goroutine 并发',
        description: '学习Go的并发编程',
        tutorial: `
            <p>Goroutine是Go的轻量级线程，使用 <code>go</code> 关键字启动：</p>
            <div class="syntax-block">go functionName()  // 并发执行函数</div>
            <p>使用匿名函数：</p>
            <div class="syntax-block">go func() {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println("Running concurrently")<br>}()</div>
            <p>注意：main函数结束时，所有goroutine会被终止。通常需要使用channel或其他同步机制等待goroutine完成。</p>
        `,
        task: '创建一个函数 <code>printMessage</code>，接收一个字符串参数并输出。在main函数中使用goroutine调用该函数输出 <code>"Hello from goroutine"</code>，然后使用 <code>time.Sleep(time.Millisecond * 100)</code> 等待goroutine完成',
        hint: 'go printMessage("Hello from goroutine")，然后 time.Sleep(time.Millisecond * 100)',
        example: `package main

import (
    "fmt"
    "time"
)

func count() {
    fmt.Println("Counting")
}

func main() {
    go count()
    time.Sleep(time.Millisecond * 100)
}`,
        initialCode: `package main

import (
    "fmt"
    "time"
)

// 定义 printMessage 函数

func main() {
    // 使用goroutine调用函数并等待
}`,
        expectedOutput: 'Hello from goroutine\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 15,
        title: 'Channel 通道',
        description: '学习使用channel进行通信',
        tutorial: `
            <p>Channel用于在goroutine之间传递数据：</p>
            <div class="syntax-block">ch := make(chan int)  // 创建int类型的channel</div>
            <p>发送和接收：</p>
            <div class="syntax-block">ch &lt;- 42  // 发送值到channel<br>value := &lt;-ch  // 从channel接收值</div>
            <p>使用示例：</p>
            <div class="syntax-block">ch := make(chan string)<br>go func() {<br>&nbsp;&nbsp;&nbsp;&nbsp;ch &lt;- "Hello"<br>}()<br>msg := &lt;-ch<br>fmt.Println(msg)</div>
        `,
        task: '创建一个int类型的channel，启动一个goroutine向channel发送数字 <code>100</code>，在main函数中接收该值并输出',
        hint: 'ch := make(chan int)，在goroutine中 ch <- 100，然后 value := <-ch',
        example: `package main

import "fmt"

func main() {
    ch := make(chan string)
    go func() {
        ch <- "Go"
    }()
    msg := <-ch
    fmt.Println(msg)
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 创建channel、使用goroutine发送数据、接收并输出
}`,
        expectedOutput: '100\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 16,
        title: '指针 Pointer',
        description: '学习指针的使用',
        tutorial: `
            <p>指针存储变量的内存地址：</p>
            <div class="syntax-block">var p *int  // 声明int类型的指针<br>x := 42<br>p = &x  // & 获取变量地址<br>value := *p  // * 解引用，获取指针指向的值</div>
            <p>指针的零值是 <code>nil</code>。</p>
            <p>指针常用于函数参数，可以修改原始变量：</p>
            <div class="syntax-block">func increment(p *int) {<br>&nbsp;&nbsp;&nbsp;&nbsp;*p = *p + 1<br>}</div>
        `,
        task: '定义一个函数 <code>double</code>，接收一个整数指针参数，将指针指向的值乘以2。在main中创建变量 <code>num := 5</code>，调用函数后输出 num',
        hint: 'func double(p *int) { *p = *p * 2 }',
        example: `package main

import "fmt"

func addOne(p *int) {
    *p = *p + 1
}

func main() {
    x := 10
    addOne(&x)
    fmt.Println(x)
}`,
        initialCode: `package main

import "fmt"

// 定义 double 函数

func main() {
    num := 5
    // 调用 double 函数并输出 num
}`,
        expectedOutput: '10\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 17,
        title: 'defer 延迟执行',
        description: '学习defer语句',
        tutorial: `
            <p><code>defer</code> 用于延迟函数的执行，直到包含它的函数返回：</p>
            <div class="syntax-block">func example() {<br>&nbsp;&nbsp;&nbsp;&nbsp;defer fmt.Println("World")<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println("Hello")<br>}<br>// 输出: Hello<br>// 输出: World</div>
            <p>多个defer语句按照后进先出（LIFO）的顺序执行。</p>
            <p>defer常用于资源清理，如关闭文件、解锁等。</p>
        `,
        task: '编写代码输出三行：<code>Start</code>、<code>Middle</code>、<code>End</code>，要求使用defer使得 "End" 最后输出',
        hint: '先 defer fmt.Println("End")，再按顺序输出其他',
        example: `package main

import "fmt"

func main() {
    defer fmt.Println("3")
    defer fmt.Println("2")
    fmt.Println("1")
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 使用 defer 输出三行
}`,
        expectedOutput: 'Start\nMiddle\nEnd\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 18,
        title: 'panic 和 recover',
        description: '学习异常处理',
        tutorial: `
            <p><code>panic</code> 用于触发运行时错误：</p>
            <div class="syntax-block">if x &lt; 0 {<br>&nbsp;&nbsp;&nbsp;&nbsp;panic("negative value")<br>}</div>
            <p><code>recover</code> 用于捕获panic，必须在defer函数中调用：</p>
            <div class="syntax-block">func safe() {<br>&nbsp;&nbsp;&nbsp;&nbsp;defer func() {<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;if r := recover(); r != nil {<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println("Recovered:", r)<br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;}<br>&nbsp;&nbsp;&nbsp;&nbsp;}()<br>&nbsp;&nbsp;&nbsp;&nbsp;panic("error")<br>}</div>
        `,
        task: '定义函数 <code>safeDivide</code>，接收两个整数，如果除数为0则使用recover捕获panic并返回0，否则返回商。调用 safeDivide(10, 2) 并输出结果',
        hint: '在defer中使用recover()捕获panic',
        example: `package main

import "fmt"

func test() (result int) {
    defer func() {
        if r := recover(); r != nil {
            result = -1
        }
    }()
    panic("error")
    return 0
}

func main() {
    fmt.Println(test())
}`,
        initialCode: `package main

import "fmt"

func safeDivide(a, b int) int {
    // 实现安全除法，捕获panic
    return a / b
}

func main() {
    fmt.Println(safeDivide(10, 2))
}`,
        expectedOutput: '5\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 19,
        title: '字符串处理',
        description: '学习strings包的使用',
        tutorial: `
            <p><code>strings</code> 包提供了丰富的字符串处理函数：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>strings.Contains(s, substr)</code> - 判断是否包含子串</li>
                <li><code>strings.Split(s, sep)</code> - 分割字符串</li>
                <li><code>strings.Join(slice, sep)</code> - 连接字符串</li>
                <li><code>strings.ToUpper(s)</code> - 转大写</li>
                <li><code>strings.ToLower(s)</code> - 转小写</li>
                <li><code>strings.Replace(s, old, new, n)</code> - 替换</li>
            </ul>
        `,
        task: '使用 strings.Split 将字符串 <code>"Go,Python,Java"</code> 按逗号分割，然后输出第二个元素',
        hint: 'import "strings"，使用 strings.Split(str, ",")',
        example: `package main

import (
    "fmt"
    "strings"
)

func main() {
    s := "hello world"
    upper := strings.ToUpper(s)
    fmt.Println(upper)
}`,
        initialCode: `package main

import (
    "fmt"
    "strings"
)

func main() {
    // 分割字符串并输出第二个元素
}`,
        expectedOutput: 'Python\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 20,
        title: '包和导入',
        description: '学习自定义包的使用',
        tutorial: `
            <p>Go程序由包组成，每个包可以包含多个文件。</p>
            <p>包名与目录名通常一致，同一目录下的文件属于同一个包。</p>
            <p>导入包的方式：</p>
            <div class="syntax-block">import "fmt"  // 单个包<br>import (<br>&nbsp;&nbsp;&nbsp;&nbsp;"fmt"<br>&nbsp;&nbsp;&nbsp;&nbsp;"strings"<br>)  // 多个包</div>
            <p>标准库常用包：<code>fmt</code>、<code>strings</code>、<code>time</code>、<code>os</code>、<code>io</code>、<code>net/http</code> 等。</p>
        `,
        task: '导入 <code>math</code> 包，使用 <code>math.Sqrt()</code> 计算 16 的平方根并输出',
        hint: 'import "math"，使用 math.Sqrt(16)',
        example: `package main

import (
    "fmt"
    "time"
)

func main() {
    now := time.Now()
    fmt.Println(now.Year())
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 计算并输出16的平方根
}`,
        expectedOutput: '4\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 21,
        title: '文件读取',
        description: '学习读取文件',
        tutorial: `
            <p>使用 <code>os</code> 和 <code>io</code> 包读取文件：</p>
            <div class="syntax-block">data, err := os.ReadFile("file.txt")<br>if err != nil {<br>&nbsp;&nbsp;&nbsp;&nbsp;log.Fatal(err)<br>}<br>fmt.Println(string(data))</div>
            <p>逐行读取：</p>
            <div class="syntax-block">file, _ := os.Open("file.txt")<br>defer file.Close()<br>scanner := bufio.NewScanner(file)<br>for scanner.Scan() {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println(scanner.Text())<br>}</div>
        `,
        task: '创建一个字符串 <code>content := "Hello, File!"</code>，使用 <code>len()</code> 函数输出字符串的字节长度（模拟文件读取后的处理）',
        hint: 'len(content) 返回字节长度',
        example: `package main

import "fmt"

func main() {
    text := "Go"
    length := len(text)
    fmt.Println(length)
}`,
        initialCode: `package main

import "fmt"

func main() {
    content := "Hello, File!"
    // 输出字符串长度
}`,
        expectedOutput: '12\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 22,
        title: '文件写入',
        description: '学习写入文件',
        tutorial: `
            <p>使用 <code>os.WriteFile</code> 写入文件：</p>
            <div class="syntax-block">data := []byte("Hello, World!")<br>err := os.WriteFile("file.txt", data, 0644)<br>if err != nil {<br>&nbsp;&nbsp;&nbsp;&nbsp;log.Fatal(err)<br>}</div>
            <p>追加写入：</p>
            <div class="syntax-block">file, _ := os.OpenFile("file.txt", os.O_APPEND|os.O_WRONLY, 0644)<br>defer file.Close()<br>file.WriteString("New line\n")</div>
        `,
        task: '创建一个字符串 <code>message := "Written successfully"</code>，将它转换为 []byte 类型，然后输出转换后的字节切片的长度',
        hint: '[]byte(message) 转换为字节切片，len() 获取长度',
        example: `package main

import "fmt"

func main() {
    s := "Go"
    bytes := []byte(s)
    fmt.Println(len(bytes))
}`,
        initialCode: `package main

import "fmt"

func main() {
    message := "Written successfully"
    // 转换为[]byte并输出长度
}`,
        expectedOutput: '20\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 23,
        title: 'JSON 编码',
        description: '学习JSON序列化',
        tutorial: `
            <p>使用 <code>encoding/json</code> 包序列化数据：</p>
            <div class="syntax-block">type Person struct {<br>&nbsp;&nbsp;&nbsp;&nbsp;Name string \`json:"name"\`<br>&nbsp;&nbsp;&nbsp;&nbsp;Age  int    \`json:"age"\`<br>}<br><br>p := Person{Name: "Alice", Age: 25}<br>data, _ := json.Marshal(p)<br>fmt.Println(string(data))</div>
            <p>使用 <code>json.MarshalIndent</code> 格式化输出。</p>
        `,
        task: '定义一个 <code>User</code> 结构体，包含 <code>Username</code>（字符串）字段。创建实例 <code>User{Username: "gopher"}</code>，使用 json.Marshal 序列化并输出结果',
        hint: 'import "encoding/json"，json.Marshal(user)',
        example: `package main

import (
    "encoding/json"
    "fmt"
)

type Book struct {
    Title string
}

func main() {
    b := Book{Title: "Go"}
    data, _ := json.Marshal(b)
    fmt.Println(string(data))
}`,
        initialCode: `package main

import (
    "encoding/json"
    "fmt"
)

type User struct {
    Username string
}

func main() {
    // 创建User实例并序列化
}`,
        expectedOutput: '{"Username":"gopher"}\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 24,
        title: 'JSON 解码',
        description: '学习JSON反序列化',
        tutorial: `
            <p>使用 <code>json.Unmarshal</code> 反序列化JSON：</p>
            <div class="syntax-block">type Person struct {<br>&nbsp;&nbsp;&nbsp;&nbsp;Name string \`json:"name"\`<br>&nbsp;&nbsp;&nbsp;&nbsp;Age  int    \`json:"age"\`<br>}<br><br>jsonStr := \`{"name":"Bob","age":30}\`<br>var p Person<br>json.Unmarshal([]byte(jsonStr), &p)<br>fmt.Println(p.Name)</div>
        `,
        task: '解析JSON字符串 <code>{"count":42}</code>，定义 <code>Result</code> 结构体包含 <code>Count int</code> 字段，输出解析后的 Count 值',
        hint: 'json.Unmarshal([]byte(jsonStr), &result)',
        example: `package main

import (
    "encoding/json"
    "fmt"
)

type Data struct {
    Value int
}

func main() {
    jsonStr := \`{"Value":10}\`
    var d Data
    json.Unmarshal([]byte(jsonStr), &d)
    fmt.Println(d.Value)
}`,
        initialCode: `package main

import (
    "encoding/json"
    "fmt"
)

type Result struct {
    Count int
}

func main() {
    jsonStr := \`{"count":42}\`
    // 解析JSON并输出Count
}`,
        expectedOutput: '42\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 25,
        title: 'HTTP 客户端',
        description: '学习发送HTTP请求',
        tutorial: `
            <p>使用 <code>net/http</code> 包发送请求：</p>
            <div class="syntax-block">resp, err := http.Get("https://api.example.com")<br>if err != nil {<br>&nbsp;&nbsp;&nbsp;&nbsp;log.Fatal(err)<br>}<br>defer resp.Body.Close()<br>body, _ := io.ReadAll(resp.Body)</div>
            <p>POST请求：</p>
            <div class="syntax-block">data := []byte(\`{"key":"value"}\`)<br>resp, _ := http.Post(url, "application/json", bytes.NewBuffer(data))</div>
        `,
        task: '创建一个字符串 <code>url := "https://api.github.com"</code>，输出该URL的长度（模拟HTTP请求准备）',
        hint: 'len(url) 返回字符串长度',
        example: `package main

import "fmt"

func main() {
    endpoint := "http://localhost:8080/api"
    fmt.Println(len(endpoint))
}`,
        initialCode: `package main

import "fmt"

func main() {
    url := "https://api.github.com"
    // 输出URL长度
}`,
        expectedOutput: '22\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 26,
        title: 'HTTP 服务器',
        description: '学习创建HTTP服务器',
        tutorial: `
            <p>使用 <code>net/http</code> 包创建服务器：</p>
            <div class="syntax-block">func handler(w http.ResponseWriter, r *http.Request) {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Fprintf(w, "Hello, World!")<br>}<br><br>http.HandleFunc("/", handler)<br>http.ListenAndServe(":8080", nil)</div>
            <p>读取请求参数：</p>
            <div class="syntax-block">name := r.URL.Query().Get("name")</div>
        `,
        task: '定义一个函数 <code>getPort</code>，返回字符串 <code>":8080"</code>，然后在main中调用并输出',
        hint: 'func getPort() string { return ":8080" }',
        example: `package main

import "fmt"

func getHost() string {
    return "localhost"
}

func main() {
    fmt.Println(getHost())
}`,
        initialCode: `package main

import "fmt"

// 定义 getPort 函数

func main() {
    // 调用并输出
}`,
        expectedOutput: ':8080\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 27,
        title: '命令行参数',
        description: '学习处理命令行参数',
        tutorial: `
            <p>使用 <code>os.Args</code> 获取命令行参数：</p>
            <div class="syntax-block">args := os.Args  // args[0]是程序名<br>if len(args) > 1 {<br>&nbsp;&nbsp;&nbsp;&nbsp;fmt.Println(args[1])<br>}</div>
            <p>使用 <code>flag</code> 包处理选项：</p>
            <div class="syntax-block">name := flag.String("name", "default", "usage")<br>flag.Parse()<br>fmt.Println(*name)</div>
        `,
        task: '创建一个字符串切片 <code>args := []string{"prog", "arg1", "arg2"}</code>，输出切片的长度',
        hint: 'len(args) 返回切片长度',
        example: `package main

import "fmt"

func main() {
    params := []string{"cmd", "file.txt"}
    fmt.Println(len(params))
}`,
        initialCode: `package main

import "fmt"

func main() {
    args := []string{"prog", "arg1", "arg2"}
    // 输出切片长度
}`,
        expectedOutput: '3\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 28,
        title: '环境变量',
        description: '学习读取环境变量',
        tutorial: `
            <p>使用 <code>os</code> 包操作环境变量：</p>
            <div class="syntax-block">value := os.Getenv("PATH")<br>fmt.Println(value)</div>
            <p>设置环境变量：</p>
            <div class="syntax-block">os.Setenv("KEY", "VALUE")</div>
            <p>检查环境变量是否存在：</p>
            <div class="syntax-block">value, exists := os.LookupEnv("KEY")</div>
        `,
        task: '创建一个字符串 <code>envKey := "HOME"</code>，输出字符串的长度',
        hint: 'len(envKey) 返回长度',
        example: `package main

import "fmt"

func main() {
    key := "PATH"
    fmt.Println(len(key))
}`,
        initialCode: `package main

import "fmt"

func main() {
    envKey := "HOME"
    // 输出字符串长度
}`,
        expectedOutput: '4\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 29,
        title: '时间处理',
        description: '学习time包的使用',
        tutorial: `
            <p>使用 <code>time</code> 包处理时间：</p>
            <div class="syntax-block">now := time.Now()<br>fmt.Println(now.Year())</div>
            <p>时间格式化（Go使用特定的基准时间）：</p>
            <div class="syntax-block">timeStr := now.Format("2006-01-02 15:04:05")</div>
            <p>时间解析：</p>
            <div class="syntax-block">t, _ := time.Parse("2006-01-02", "2023-01-15")</div>
            <p>时间计算：</p>
            <div class="syntax-block">tomorrow := now.Add(24 * time.Hour)</div>
        `,
        task: '导入time包，输出字符串 <code>"2024"</code>（模拟获取年份）',
        hint: '直接 fmt.Println("2024")',
        example: `package main

import (
    "fmt"
    "time"
)

func main() {
    duration := 24 * time.Hour
    fmt.Println(duration.Hours())
}`,
        initialCode: `package main

import (
    "fmt"
    "time"
)

func main() {
    // 输出 "2024"
}`,
        expectedOutput: '2024\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    },
    {
        id: 30,
        title: '编译和打包',
        description: '学习Go程序的编译部署',
        tutorial: `
            <p>编译Go程序：</p>
            <div class="syntax-block">go build main.go  // 生成可执行文件<br>go build -o myapp main.go  // 指定输出文件名</div>
            <p>交叉编译（不同平台）：</p>
            <div class="syntax-block">GOOS=linux GOARCH=amd64 go build main.go<br>GOOS=windows GOARCH=amd64 go build main.go</div>
            <p>常用编译选项：</p>
            <ul style="margin:8px 0 8px 20px;line-height:2;">
                <li><code>go build</code> - 编译包和依赖</li>
                <li><code>go install</code> - 编译并安装到GOPATH/bin</li>
                <li><code>go run</code> - 编译并立即运行</li>
            </ul>
            <p>减小可执行文件大小：</p>
            <div class="syntax-block">go build -ldflags="-s -w" main.go</div>
        `,
        task: '输出字符串 <code>"Build completed!"</code> 庆祝你完成了所有Go语言学习关卡',
        hint: 'fmt.Println("Build completed!")',
        example: `package main

import "fmt"

func main() {
    fmt.Println("Program started")
}`,
        initialCode: `package main

import "fmt"

func main() {
    // 输出 "Build completed!"
}`,
        expectedOutput: 'Build completed!\n',
        validate(output, expected) {
            return output.trim() === expected.trim();
        }
    }
];

// ===== 状态管理 =====
let currentLevel = null;
let completedLevels = new Set();

// 从localStorage加载进度
function loadProgress() {
    const saved = localStorage.getItem('go-learn-progress');
    if (saved) {
        completedLevels = new Set(JSON.parse(saved));
    }
}

// 保存进度
function saveProgress() {
    localStorage.setItem('go-learn-progress', JSON.stringify([...completedLevels]));
}

// 检查关卡是否解锁
function isLevelUnlocked(levelId) {
    // 第一关总是解锁
    if (levelId === 1) return true;
    // 其他关卡需要前一关完成
    return completedLevels.has(levelId - 1);
}

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', () => {
    loadProgress();
    renderLevelSelect();
    bindEvents();
    checkServerAvailability();
});

// 检查服务器可用性
async function checkServerAvailability() {
    try {
        const response = await fetch('/api/run-go', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: 'package main\n\nfunc main() {}' })
        });
        
        if (!response.ok) {
            showServerError('服务器 API 不可用，请确保服务器正在运行。');
        }
    } catch (error) {
        showServerError('无法连接到服务器，请确保服务器正在运行。');
    }
}

// 显示服务器错误
function showServerError(message) {
    const notice = document.querySelector('.server-notice');
    if (notice) {
        notice.style.background = 'rgba(248, 113, 113, 0.15)';
        notice.style.borderColor = 'rgba(248, 113, 113, 0.3)';
        notice.querySelector('.notice-content').innerHTML = `<strong>错误：</strong>${message}`;
        notice.querySelector('.notice-content').style.color = '#f87171';
    }
}

// ===== 关卡选择界面 =====
function renderLevelSelect() {
    const grid = document.getElementById('levelGrid');
    const progressBar = document.getElementById('totalProgress');
    const progressText = document.getElementById('progressText');
    
    const completed = completedLevels.size;
    const total = LEVELS.length;
    const percentage = (completed / total) * 100;
    
    progressBar.style.width = percentage + '%';
    progressText.textContent = `已完成 ${completed} / ${total} 关`;
    
    grid.innerHTML = '';
    LEVELS.forEach(level => {
        const card = document.createElement('div');
        card.className = 'level-card';
        const isCompleted = completedLevels.has(level.id);
        const isUnlocked = isLevelUnlocked(level.id);
        
        if (isCompleted) {
            card.classList.add('completed');
        }
        
        if (!isUnlocked) {
            card.classList.add('locked');
        }
        
        if (isUnlocked && !isCompleted) {
            card.classList.add('unlocked');
        }
        
        card.innerHTML = `
            <div class="level-number">关卡 ${level.id}</div>
            <div class="level-name">${level.title}</div>
            <div class="level-desc">${level.description}</div>
            ${!isUnlocked ? '<div class="lock-icon">🔒</div>' : ''}
        `;
        
        if (isUnlocked) {
            card.onclick = () => loadLevel(level.id);
        } else {
            card.onclick = () => {
                alert('请先完成前面的关卡！');
            };
        }
        
        grid.appendChild(card);
    });
}

// ===== 关卡详情 =====
function loadLevel(levelId) {
    // 检查关卡是否解锁
    if (!isLevelUnlocked(levelId)) {
        alert('请先完成前面的关卡！');
        return;
    }
    
    currentLevel = LEVELS.find(l => l.id === levelId);
    if (!currentLevel) return;
    
    document.getElementById('levelSelect').style.display = 'none';
    document.getElementById('levelDetail').style.display = 'block';
    
    document.getElementById('levelTitle').textContent = `关卡 ${currentLevel.id}: ${currentLevel.title}`;
    document.getElementById('tutorialContent').innerHTML = currentLevel.tutorial;
    document.getElementById('taskContent').innerHTML = currentLevel.task;
    document.getElementById('exampleContent').innerHTML = `<pre><code>${escapeHtml(currentLevel.example)}</code></pre>`;
    document.getElementById('codeEditor').value = currentLevel.initialCode;
    document.getElementById('outputArea').innerHTML = '<p class="placeholder-text">运行代码后在此查看输出</p>';
    document.getElementById('expectedSection').style.display = 'none';
    document.getElementById('hintBox').style.display = 'none';
    
    // 更新导航按钮
    document.getElementById('btnPrevLevel').disabled = currentLevel.id === 1;
    document.getElementById('btnNextLevel').disabled = currentLevel.id === LEVELS.length;
}

function showLevelSelect() {
    document.getElementById('levelDetail').style.display = 'none';
    document.getElementById('levelSelect').style.display = 'block';
    renderLevelSelect();
}

// ===== 代码执行 =====
async function runCode() {
    const code = document.getElementById('codeEditor').value;
    const outputArea = document.getElementById('outputArea');
    
    if (!code.trim()) {
        outputArea.innerHTML = '<p class="error-text">请输入代码</p>';
        return;
    }
    
    outputArea.innerHTML = '<p class="info-text">正在运行...</p>';
    
    try {
        const response = await fetch('/api/run-go', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });
        
        const result = await response.json();
        
        if (result.success) {
            outputArea.innerHTML = `<pre>${escapeHtml(result.output)}</pre>`;
        } else {
            outputArea.innerHTML = `<p class="error-text">错误：</p><pre>${escapeHtml(result.error)}</pre>`;
        }
    } catch (error) {
        outputArea.innerHTML = `<p class="error-text">运行失败：${escapeHtml(error.message)}</p><p class="error-text" style="margin-top:10px;">提示：请确保服务器正在运行且安装了 Go 环境。</p>`;
    }
}

// ===== 提交答案 =====
async function submitAnswer() {
    const code = document.getElementById('codeEditor').value;
    const outputArea = document.getElementById('outputArea');
    const expectedSection = document.getElementById('expectedSection');
    const expectedArea = document.getElementById('expectedArea');
    
    if (!code.trim()) {
        alert('请输入代码');
        return;
    }
    
    outputArea.innerHTML = '<p class="info-text">正在验证...</p>';
    
    try {
        const response = await fetch('/api/run-go', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code: code })
        });
        
        const result = await response.json();
        
        expectedSection.style.display = 'block';
        expectedArea.innerHTML = `<pre>${escapeHtml(currentLevel.expectedOutput)}</pre>`;
        
        if (result.success) {
            outputArea.innerHTML = `<pre>${escapeHtml(result.output)}</pre>`;
            
            const isCorrect = currentLevel.validate(result.output, currentLevel.expectedOutput);
            
            if (isCorrect) {
                completedLevels.add(currentLevel.id);
                saveProgress();
                showSuccessModal();
            } else {
                alert('输出不正确，请再试试！');
            }
        } else {
            outputArea.innerHTML = `<p class="error-text">错误：</p><pre>${escapeHtml(result.error)}</pre>`;
        }
    } catch (error) {
        outputArea.innerHTML = `<p class="error-text">提交失败：${escapeHtml(error.message)}</p><p class="error-text" style="margin-top:10px;">提示：请确保服务器正在运行且安装了 Go 环境。</p>`;
    }
}

// ===== 通关弹窗 =====
function showSuccessModal() {
    const modal = document.getElementById('successModal');
    const msg = document.getElementById('successMsg');
    
    let message = `你已完成关卡 ${currentLevel.id}: ${currentLevel.title}！`;
    if (currentLevel.id < LEVELS.length) {
        message += ` 下一关已解锁！`;
    } else {
        message += ` 恭喜你完成了所有关卡！`;
    }
    
    msg.textContent = message;
    modal.style.display = 'flex';
    
    const nextBtn = document.getElementById('btnNextFromModal');
    nextBtn.disabled = currentLevel.id === LEVELS.length;
}

function hideSuccessModal() {
    document.getElementById('successModal').style.display = 'none';
}

// ===== 事件绑定 =====
function bindEvents() {
    document.getElementById('btnRun').onclick = runCode;
    document.getElementById('btnSubmit').onclick = submitAnswer;
    
    document.getElementById('btnHint').onclick = () => {
        const hintBox = document.getElementById('hintBox');
        if (hintBox.style.display === 'none') {
            hintBox.textContent = currentLevel.hint;
            hintBox.style.display = 'block';
        } else {
            hintBox.style.display = 'none';
        }
    };
    
    document.getElementById('btnPrevLevel').onclick = () => {
        if (currentLevel.id > 1) {
            loadLevel(currentLevel.id - 1);
        }
    };
    
    document.getElementById('btnNextLevel').onclick = () => {
        if (currentLevel.id < LEVELS.length) {
            loadLevel(currentLevel.id + 1);
        }
    };
    
    document.getElementById('btnBackToList').onclick = () => {
        hideSuccessModal();
        showLevelSelect();
    };
    
    document.getElementById('btnNextFromModal').onclick = () => {
        hideSuccessModal();
        if (currentLevel.id < LEVELS.length) {
            loadLevel(currentLevel.id + 1);
        }
    };
    
    document.getElementById('successModal').onclick = (e) => {
        if (e.target.id === 'successModal') {
            hideSuccessModal();
        }
    };
}

// ===== 工具函数 =====
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = '../../index.html';
    }
}
