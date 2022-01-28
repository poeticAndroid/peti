(() => {
  let cpu,
    ram = new WebAssembly.Memory({ initial: 4 }),
    mem = new Uint8Array(ram.buffer),
    speed = 1,
    vsyncfps = 9000,
    fps = 9000,
    fpssec = 0,
    running = false,
    waitingforuser = false,
    sleep = false,
    kbEnabled = true,
    kbBuffer = []

  let diskInitialized = false,
    diskInput = [],
    diskOutput = []

  let img,
    canvas = document.querySelector("canvas"),
    g = canvas.getContext("2d"),
    maxwidth = 1024,
    gmode = -1

  let uint8 = new Uint8Array(4),
    int32 = new Int32Array(uint8.buffer),
    float32 = new Float32Array(uint8.buffer)

  async function init() {
    addEventListener("resize", resize); resize()
    addEventListener("keydown", onUser)
    addEventListener("keyup", onUser)
    canvas.addEventListener("mousedown", onUser)
    canvas.addEventListener("mouseup", onUser)
    canvas.addEventListener("mousemove", onUser)

    document.querySelector("#asmTxt").value = localStorage.getItem("program.asm") || `;;Peti asm
    ;; https://github.com/poeticAndroid/peti

    (main: ;; must be the first function
      (@vars $argv
        )
      (sys (0x03) (@call memstart) (0x400) (2)) ;; printstr syscall
    
      (@return (0)) ;; return to dos with no error
    )
    
    (memstart: ;; must be the last function
      (@return (add (8) (here)))
    )

    (@string 0xe "Hello world!\\n")
    `.replaceAll("\n    ", "\n")
    document.querySelector("#adrTxt").value = localStorage.getItem("?adr") || "0x10000"
    document.querySelector("#speedTxt").value = localStorage.getItem("?speed") || "16"
    document.querySelector("#speedTxt").addEventListener("change", changeSpeed); changeSpeed()
    document.querySelector("#compileBtn").addEventListener("click", compileAsm)
    document.querySelector("#stopBtn").addEventListener("click", e => { running = false; clearTimeout(sleep) })
    document.querySelector("#stepBtn").addEventListener("click", e => cpu.run(1))
    document.querySelector("#runBtn").addEventListener("click", e => running = true)

    document.querySelector("#asmTxt").addEventListener("focus", e => kbEnabled = false)
    document.querySelector("#adrTxt").addEventListener("focus", e => kbEnabled = false)
    document.querySelector("#speedTxt").addEventListener("focus", e => kbEnabled = false)

    for (let i = 0; i < mem.length; i++) {
      mem[i] = 255 * Math.random()
      if (i > 8) {
        mem[i] = mem[i] & mem[1]
        mem[i] = mem[i] ^ mem[2]
      }
    }
    await loadCPU("cpu.wasm", { pcb: { ram: ram } })
    hwClock()
    render()
    window.mem = mem
    window.kbBuffer = kbBuffer
    console.log("cpu", cpu)
    console.log("mem", mem)
    console.log("img", img)
    setTimeout(loadROM, 256)
  } init()

  async function loadCPU(path, imports) {
    let bin = await (await fetch(path)).arrayBuffer()
    let wasm = await WebAssembly.instantiate(bin, imports)
    cpu = wasm.instance.exports
    window.cpu = cpu
  }

  function loadROM() {
    let bin
    bin = JSON.parse("[" +
      atob(kernal)
      + "]")
    mem.set(bin, 0x400)
    bin = JSON.parse("[" +
      atob(font)
      + "]")
    mem.set(bin, 0xb000)
    running = true
  }

  function render(t = 0) {
    let opcode
    if (running) {
      if (kbBuffer.length && mem[0xb4f4] === 0) {
        mem[0xb4f5] = kbBuffer.shift()
        mem[0xb4f4] = Math.min(255, 1 + kbBuffer.length)
      }
      try {
        opcode = cpu.run(speed)
      } catch (err) {
        console.error("CPU CRASH!! OH NOEZ!! O_O")
        running = false
        return setTimeout(() => {
          delete cpu
          loadCPU("cypu.wasm", { pcb: { ram: ram } }).then(
            render()
          )
        }, 16384)
      }
      // console.log(cpu.getReg(0), opcode)
      switch (opcode) {
        case 0x00: // halt
          running = false
          break
        case 0x01: // sleep
          running = false
          let adr = cpu.getVS()
          uint8.set(mem.slice(adr, adr + 4))
          sleep = setTimeout(() => {
            running = true
          }, int32[0])
          break
        case 0x02:
          vsyncfps++
          break
      }
    }

    // rendering
    let mode = mem[0xb4f8],
      bpp = Math.pow(2, mode & 0x3)
    if (gmode !== mode) {
      let pw = 1, ph = 1
      let w, h, px

      px = (18 * 1024 * 8) / bpp
      if (bpp & 0xa) {
        pw = 1 + (mode & 0x4) / 4
        ph = 3 - pw
      }
      w = ((mode & 0x3) > 1 ? 256 : 512) / pw
      h = px / w
      while (w * pw < maxwidth) {
        pw *= 2
        ph *= 2
      }

      canvas.width = w; canvas.height = h
      canvas.style.width = (w * pw) + "px"
      canvas.style.height = (h * ph) + "px"
      g.fillRect(0, 0, canvas.width, canvas.height)
      img = g.getImageData(0, 0, canvas.width, canvas.height)
      gmode = mode
    }
    let start = 0xb800
    let end = 0x10000
    let i = 0
    for (let m = start; m < end; m++) {
      i += renderbyte(m, i, bpp)
    }

    g.putImageData(img, 0, 0)
    updateMonitor(cpu.getPC())
    updateStack()

    fps++
    if (fpssec !== Math.floor(t / 1000)) {
      document.querySelector("#fps").textContent = vsyncfps + "/" + fps + " fps"
      fps = 0
      vsyncfps = 0
      fpssec = Math.floor(t / 1000)
    }

    requestAnimationFrame(render)
    // setTimeout(render, 256)
  }

  function renderbyte(madr, iadr, bpp) {
    let byte = mem[madr]
    let ppb = 8 / bpp
    let mask = Math.pow(2, bpp) - 1
    iadr += 4 * ppb
    let bm = 0xf
    let bs = 4
    let rm = 0xf
    let rs = 4
    let gm = 0xf
    let gs = 4
    while (bs + rs + gs > bpp) {
      if (bs + rs + gs > bpp) {
        bs--; bm = bm >> 1
      }
      if (bs + rs + gs > bpp) {
        rs--; rm = rm >> 1
      }
      if (bs + rs + gs > bpp) {
        gs--; gm = gm >> 1
      }
    }
    if (bpp === 2) {
      bm = 1; rm = 2; gm = 3
      gs = 2; rs = 0
    }
    if (bpp === 1) {
      bm = 1; rm = 1; gm = 1
    }
    for (let i = 0; i < ppb; i++) {
      iadr -= 4
      // let c = byte & mask
      img.data[iadr + 2] = 255 * ((byte & bm) / bm)
      byte = byte >> bs
      img.data[iadr + 0] = 255 * ((byte & rm) / rm)
      byte = byte >> rs
      img.data[iadr + 1] = 255 * ((byte & gm) / gm)
      byte = byte >> gs
    }
    return ppb * 4
  }

  function onUser(e) {
    if (e.type.slice(0, 5) === "mouse") {
      mem[0xb4f9] = Math.max(0, (e.offsetX / e.target.clientWidth) * 255)
      mem[0xb4fa] = Math.max(0, (e.offsetY / e.target.clientHeight) * 144)
      if (mem[0xb4fb] = e.buttons) kbEnabled = true
    }

    if (e.type === "keyup") {
      mem[0xb4f7] = e.shiftKey + 2 * e.altKey + 4 * e.ctrlKey + 4 * e.metaKey
    }
    if (e.type === "keydown") {
      if (kbEnabled) {
        mem[0xb4f6] = e.keyCode
        mem[0xb4f7] = e.shiftKey + 2 * e.altKey + 4 * e.ctrlKey + 4 * e.metaKey
        if (!e.ctrlKey && !e.metaKey) {
          if (e.key === "Backspace") {
            kbBuffer.push(0x08)
          }
          if (e.key === "Tab") {
            kbBuffer.push(0x09)
            e.preventDefault()
          }
          if (e.key === "Enter") {
            kbBuffer.push(0x0a)
          }
          if (e.key === "Escape") {
            kbBuffer.push(0x1b)
          }
          if (e.key === "Delete") {
            kbBuffer.push(0x7f)
          }
          if (e.key.length === 1) {
            kbBuffer.push(e.key.charCodeAt(0))
          }
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "q") {
        compileAsm()
      }
    }
    if (!running) kbBuffer.length = 0

    if (waitingforuser) {
      waitingforuser = false
      running = true
    }
  }

  function handleDrive() {
    //todo
  }

  function hwClock() {
    let now = new Date()
    mem[0xb4e8] = now.getYear()
    mem[0xb4e9] = now.getMonth()
    mem[0xb4ea] = now.getDate()
    mem[0xb4eb] = now.getDay()
    mem[0xb4ec] = now.getHours()
    mem[0xb4ed] = now.getMinutes()
    mem[0xb4ee] = now.getSeconds()
    mem[0xb4ef] = 0
    setTimeout(hwClock, 1000 - now.getMilliseconds())
  }

  function changeSpeed(e) {
    let s = eval(document.querySelector("#speedTxt").value)
    speed = Math.pow(2, s)
    localStorage.setItem("?speed", document.querySelector("#speedTxt").value)
  }

  function compileAsm(e) {
    let asm = document.querySelector("#asmTxt").value
    let offset = eval(document.querySelector("#adrTxt").value)
    let bin = assemble(asm)
    mem.set(bin, offset)
    cpu.setPC(0x400)
    cpu.setCS(0)
    cpu.setVS(0)
    console.log(dumpMem(offset, bin.length))
    localStorage.setItem("program.asm", asm)
    localStorage.setItem("?adr", document.querySelector("#adrTxt").value)
  }

  function dumpMem(adr, len, pc) {
    adr = Math.max(0, adr)
    let txt = ""
    let end = adr + len
    while (adr < end) {
      txt += (adr == pc ? "> " : "  ")
      txt += ("000000" + adr.toString(16)).slice(-5) + " "
      txt += ("00" + mem[adr].toString(16)).slice(-2) + " "
      txt += (opcodes[mem[adr]] || "") + " "
      if (opcodes[mem[adr]] === "const") {
        uint8.set(mem.slice(adr + 1, adr + 5))
        txt += "0x" + int32[0].toString(16) + " " + int32[0]
        adr += 4
      }
      txt += "\n"
      adr++
    }
    return txt
  }

  function dumpStack(len) {
    let adr = cpu.getVS()
    let cs = cpu.getCS()
    let txt = ""
    while (len > 0) {
      if (cs === adr) {
        txt += "--------\n"
        cs = -1
        len--
      }
      uint8.set(mem.slice(adr - 4, adr))
      if (adr > 0) {
        txt += "0x" + ("00000000" + int32[0].toString(16)).slice(-8) + " " + int32[0] + " "
        if (float32[0]) txt += float32[0]
      }
      if (cs < 0) cs = int32[0]
      len--
      adr -= 4
      if (adr <= 0) len = 0
      txt += "\n"
    }
    return txt
  }

  function updateMonitor(pc) {
    let txt = ""
    let i = 32
    while (!txt.includes(">"))
      txt = dumpMem(pc - i++, 64, pc)
    txt = txt.slice(0, txt.indexOf(">"))
    txt = txt.split("\n").slice(-6).join("\n")
    txt += dumpMem(pc, 64, pc)
    txt = txt.split("\n").slice(0, 17).join("\n")
    document.querySelector("#monitorPre").textContent = txt
  }

  function updateStack() {
    document.querySelector("#stackPre").textContent = "Stack size: 0x" + cpu.getVS().toString(16) + "\n" + dumpStack(10)
  }

  function resize(e) {
    if (window.innerWidth < 1070 || window.innerHeight < 700) {
      maxwidth = 512
    } else {
      maxwidth = 1024
    }
    gmode = -1
  }

  const font = 'MCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMTUsMTUsMTUsMTUsMCwwLDAsMCwyNDAsMjQwLDI0MCwyNDAsMCwwLDAsMCwyNTUsMjU1LDI1NSwyNTUsMTUsMTUsMTUsMTUsMCwwLDAsMCwxNSwxNSwxNSwxNSwxNSwxNSwxNSwxNSwxNSwxNSwxNSwxNSwyNDAsMjQwLDI0MCwyNDAsMTUsMTUsMTUsMTUsMjU1LDI1NSwyNTUsMjU1LDI0MCwyNDAsMjQwLDI0MCwwLDAsMCwwLDI0MCwyNDAsMjQwLDI0MCwxNSwxNSwxNSwxNSwyNDAsMjQwLDI0MCwyNDAsMjQwLDI0MCwyNDAsMjQwLDI0MCwyNDAsMjQwLDI0MCwyNTUsMjU1LDI1NSwyNTUsMjU1LDI1NSwyNTUsMjU1LDAsMCwwLDAsMjU1LDI1NSwyNTUsMjU1LDE1LDE1LDE1LDE1LDI1NSwyNTUsMjU1LDI1NSwyNDAsMjQwLDI0MCwyNDAsMjU1LDI1NSwyNTUsMjU1LDI1NSwyNTUsMjU1LDI1NSwwLDAsMCwwLDAsMCwwLDAsMjQsMjQsMjQsMjQsMCwwLDAsMCwwLDAsMCwxNSwxNSwwLDAsMCwyNCwyNCwyNCwzMSwxNSwwLDAsMCwwLDAsMCwwLDI0LDI0LDI0LDI0LDI0LDI0LDI0LDI0LDI0LDI0LDI0LDI0LDAsMCwwLDE1LDMxLDI0LDI0LDI0LDI0LDI0LDI0LDMxLDMxLDI0LDI0LDI0LDAsMCwwLDI0MCwyNDAsMCwwLDAsMjQsMjQsMjQsMjQ4LDI0MCwwLDAsMCwwLDAsMCwyNTUsMjU1LDAsMCwwLDI0LDI0LDI0LDI1NSwyNTUsMCwwLDAsMCwwLDAsMjQwLDI0OCwyNCwyNCwyNCwyNCwyNCwyNCwyNDgsMjQ4LDI0LDI0LDI0LDAsMCwwLDI1NSwyNTUsMjQsMjQsMjQsMjQsMjQsMjQsMjU1LDI1NSwyNCwyNCwyNCwwLDAsMCwwLDAsMCwwLDAsMTYsMTYsMTYsMTYsMTYsMCwxNiwwLDY4LDY4LDAsMCwwLDAsMCwwLDM2LDEyNiwzNiwzNiwzNiwxMjYsMzYsMCwxNiw2MCw2NCw1Niw0LDEyMCwxNiwwLDY2LDE2NCw3MiwxNiwzNiw3NCwxMzIsMCwyOCwzNCwzNiwyNCwzNyw2Niw2MSwwLDgsOCwwLDAsMCwwLDAsMCw4LDE2LDMyLDMyLDMyLDE2LDgsMCwxNiw4LDQsNCw0LDgsMTYsMCwxNiw4NCw1Niw4NCwxNiwwLDAsMCwwLDE2LDE2LDEyNCwxNiwxNiwwLDAsMCwwLDAsMCw4LDgsMTYsMCwwLDAsMCwxMjYsMCwwLDAsMCwwLDAsMCwwLDAsMCwxNiwwLDIsNCw4LDE2LDMyLDY0LDEyOCwwLDU2LDY4LDY4LDY4LDY4LDY4LDU2LDAsMTYsNDgsMTYsMTYsMTYsMTYsMTI0LDAsNTYsNjgsNCwyNCwzMiw2NCwxMjQsMCw1Niw2OCw0LDI0LDQsNjgsNTYsMCwyNCw0MCw3Miw3MiwxMjQsOCw4LDAsMTI0LDY0LDEyMCw0LDQsNjgsNTYsMCw1Niw2OCw2NCwxMjAsNjgsNjgsNTYsMCwxMjQsNCw4LDE2LDE2LDE2LDE2LDAsNTYsNjgsNjgsNTYsNjgsNjgsNTYsMCw1Niw2OCw2OCw2MCw0LDY4LDU2LDAsMCwxNiwwLDAsMTYsMCwwLDAsMCw4LDAsMCw4LDE2LDAsMCw0LDgsMTYsMzIsMTYsOCw0LDAsMCwwLDEyNiwwLDEyNiwwLDAsMCwxNiw4LDQsMiw0LDgsMTYsMCw1Niw2OCw0LDI0LDE2LDAsMTYsMCw2MCw2NiwxNTMsMTY1LDE2NSwxNTgsNjQsNjAsMTYsNDAsNDAsNjgsMTI0LDEzMCwxMzAsMCwyNTIsMTMwLDEzMCwyNTIsMTMwLDEzMCwyNTIsMCwxMjQsMTMwLDEyOCwxMjgsMTI4LDEzMCwxMjQsMCwyNTIsMTMwLDEzMCwxMzAsMTMwLDEzMCwyNTIsMCwyNTQsMTI4LDEyOCwyNDgsMTI4LDEyOCwyNTQsMCwyNTQsMTI4LDEyOCwyNDgsMTI4LDEyOCwxMjgsMCwxMjQsMTMwLDEyOCwxNDIsMTMwLDEzMCwxMjQsMCwxMzAsMTMwLDEzMCwyNTQsMTMwLDEzMCwxMzAsMCwxMjQsMTYsMTYsMTYsMTYsMTYsMTI0LDAsMiwyLDIsMiwyLDEzMCwxMjQsMCwxMzAsMTMyLDEzNiwyNDAsMTM2LDEzMiwxMzAsMCwxMjgsMTI4LDEyOCwxMjgsMTI4LDEyOCwyNTQsMCwxMzAsMTk4LDE3MCwxNDYsMTMwLDEzMCwxMzAsMCwxMzAsMTk0LDE2MiwxNDYsMTM4LDEzNCwxMzAsMCwxMjQsMTMwLDEzMCwxMzAsMTMwLDEzMCwxMjQsMCwyNTIsMTMwLDEzMCwxMzAsMjUyLDEyOCwxMjgsMCwxMjQsMTMwLDEzMCwxMzAsMTMwLDEzOCwxMjQsMiwyNTIsMTMwLDEzMCwyNTIsMTMyLDEzMCwxMzAsMCwxMjQsMTMwLDEyOCwxMjQsMiwxMzAsMTI0LDAsMjU0LDE2LDE2LDE2LDE2LDE2LDE2LDAsMTMwLDEzMCwxMzAsMTMwLDEzMCwxMzAsMTI0LDAsMTMwLDEzMCwxMzAsMTMwLDY4LDQwLDE2LDAsMTMwLDEzMCwxNDYsMTQ2LDE0NiwxMDgsNjgsMCwxMzAsNjgsNDAsMTYsNDAsNjgsMTMwLDAsMTMwLDEzMCw2OCw0MCwxNiwxNiwxNiwwLDI1NCw0LDgsMTYsMzIsNjQsMjU0LDAsNTYsMzIsMzIsMzIsMzIsMzIsNTYsMCwxMjgsNjQsMzIsMTYsOCw0LDIsMCwyOCw0LDQsNCw0LDQsMjgsMCwxNiw0MCw2OCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwyNTUsMTYsOCwwLDAsMCwwLDAsMCwwLDAsNjAsMiw2Miw2Niw2MiwwLDY0LDY0LDEyNCw2Niw2Niw2NiwxMjQsMCwwLDAsNjAsNjYsNjQsNjYsNjAsMCwyLDIsNjIsNjYsNjYsNjYsNjIsMCwwLDAsNjAsNjYsMTI0LDY0LDYyLDAsMTIsMTYsNTYsMTYsMTYsMTYsMTYsMCwwLDAsNjIsNjYsNjYsNjIsMiw2MCw2NCw2NCwxMjQsNjYsNjYsNjYsNjYsMCwxNiwwLDQ4LDE2LDE2LDE2LDU2LDAsNCwwLDEyLDQsNCw0LDY4LDU2LDY0LDY0LDY2LDY4LDEyMCw2OCw2NiwwLDQ4LDE2LDE2LDE2LDE2LDE2LDE2LDAsMCwwLDI1MiwxNDYsMTQ2LDE0NiwxNDYsMCwwLDAsMTI0LDY2LDY2LDY2LDY2LDAsMCwwLDYwLDY2LDY2LDY2LDYwLDAsMCwwLDEyNCw2Niw2Niw2NiwxMjQsNjQsMCwwLDYyLDY2LDY2LDY2LDYyLDIsMCwwLDk0LDk2LDY0LDY0LDY0LDAsMCwwLDYyLDY0LDYwLDIsMTI0LDAsMTYsMTYsNTYsMTYsMTYsMTYsMTIsMCwwLDAsNjYsNjYsNjYsNjYsNjIsMCwwLDAsNjYsNjYsNjYsMzYsMjQsMCwwLDAsNjUsNzMsNzMsNzMsNTQsMCwwLDAsNjgsNDAsMTYsNDAsNjgsMCwwLDAsNjYsNjYsNjYsNjIsMiw2MCwwLDAsMTI0LDgsMTYsMzIsMTI0LDAsOCwxNiwxNiwzMiwxNiwxNiw4LDAsMTYsMTYsMTYsMTYsMTYsMTYsMTYsMTYsMTYsOCw4LDQsOCw4LDE2LDAsMCwwLDk2LDE0NiwxMiwwLDAsMA=='
  const kernal = 'MTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNywxNiwwLDAsMCwwLDQ4LDE2LDIzLDAsMCwwLDUsMTYsODUsMSwwLDAsMTYsMCwwLDAsMCw4LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDAsMCwwLDAsMTcsMTYsMiwwLDAsMCw0OCwxNiwyOSwwLDAsMCw1LDE2LDEsMCwwLDAsMTcsMTYsNjEsMTAsMCwwLDE2LDEsMCwwLDAsOCwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwwLDAsMCwwLDE3LDE2LDMsMCwwLDAsNDgsMTYsMjksMCwwLDAsNSwxNiwxLDAsMCwwLDE3LDE2LDE4NywxMywwLDAsMTYsMSwwLDAsMCw4LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDAsMCwwLDAsMTcsMTYsMTYsMCwwLDAsNDgsMTYsNDEsMCwwLDAsNSwxNiwxLDAsMCwwLDE3LDE2LDIsMCwwLDAsMTcsMTYsMywwLDAsMCwxNywxNiw1OSwzLDAsMCwxNiwzLDAsMCwwLDgsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxNywxNiwyNSwwLDAsMCw0OCwxNiwyMywwLDAsMCw1LDE2LDE2LDE1LDAsMCwxNiwwLDAsMCwwLDgsMTYsMSwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxNywxNiwyNiwwLDAsMCw0OCwxNiwyMywwLDAsMCw1LDE2LDM4LDE1LDAsMCwxNiwwLDAsMCwwLDgsMTYsMSwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxNywxNiwyNywwLDAsMCw0OCwxNiwyMywwLDAsMCw1LDE2LDEwNCwxNSwwLDAsMTYsMCwwLDAsMCw4LDE2LDEsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDAsMCwwLDAsMTcsMTYsMzIsMCwwLDAsNDgsMTYsMzUsMCwwLDAsNSwxNiwxLDAsMCwwLDE3LDE2LDIsMCwwLDAsMTcsMTYsOSwxNiwwLDAsMTYsMiwwLDAsMCw4LDE2LDEsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDEyLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDQsMCwwLDEsMTYsMCwwLDAsMCwxNiwwLDE4MCwwLDAsMjUsMTYsMSwwLDAsMCwxNiwzLDIsMSwwLDI1LDE2LDAsMCwwLDAsMTcsMTYsMCwwLDEsMCw0OSwxNiw2MSwwLDAsMCw1LDE2LDAsMCwwLDAsMTcsMTYsMSwwLDAsMCwxNywyNywxNiwxLDAsMCwwLDE2LDEsMCwwLDAsMTcsMTYsNCw0LDQsNCwzMiwyNSwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsNCwwLDAsMCwzMiwyNSwxNiwxODMsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxNiwwLDE4MCwwLDAsMjUsMTYsMCwwLDAsMCwxNywxNiwwLDAsMSwwLDQ5LDE2LDQyLDAsMCwwLDUsMTYsMCwwLDAsMCwxNywxNiwwLDAsMCwwLDI3LDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNywxNiw0LDAsMCwwLDMyLDI1LDE2LDIwMiwyNTUsMjU1LDI1NSw0LDE2LDAsMCwwLDAsNCwxNiw1NywwLDAsMCwxNiwwLDAsMCwwLDgsMTYsMCwwLDEsMCwyMSwxNiwxNiwwLDAsMCw0OCwxNiwyMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTYsMCwwLDEsMCwxNiwxLDAsMCwwLDksMTYsMCwwLDAsMCw0LDE2LDg0LDAsMCwwLDE2LDAsMCwwLDAsOCwxNiwyNTUsMjU0LDI1NSwyNTUsNCwxNiwyNTIsMTc1LDAsMCwxNiwwLDAsMCwwLDI3LDE2LDI1NSwxNzUsMCwwLDE2LDI1NSwyNTUsMjU1LDI1NSwyOSwxNiwyNDgsMTgwLDAsMCwxNiwxLDAsMCwwLDI5LDE2LDU3LDE1LDAsMCwxNiwwLDAsMCwwLDgsMTYsMTQwLDExLDAsMCwxNiwxLDAsMCwwLDgsMTYsMjQ4LDE4MCwwLDAsMTYsMCwwLDAsMCwyOSwxNiwwLDQsMCwwLDEsMTYsMCwwLDAsMCwxMSwxNiwyNDQsMTgwLDAsMCwxOSwxNiwyNCwwLDAsMCw1LDE2LDI0NCwxODAsMCwwLDE2LDAsMCwwLDAsMjcsMiwxNiwyMjYsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMjMyLDE0LDAsMCwxNiwwLDAsMCwwLDgsMTYsNjQsMCwwLDAsMzIsMTYsNTMsMTEsMCwwLDE2LDEsMCwwLDAsOCwxNiwyLDAsMCwwLDE2LDEyOSwwLDAsMCwxNiwwLDQsMCwwLDE2LDIsMCwwLDAsOSwxNiwyLDAsMCwwLDE2LDgsMCwwLDAsMTYsMCw0LDAsMCwxNiwyLDAsMCwwLDksMTYsMSwwLDAsMCwxNiwxODEsMCwwLDAsNSwxNiwyNDQsMTgwLDAsMCwxOSw1MSwxNiwxMywwLDAsMCw1LDIsMTYsMjM2LDI1NSwyNTUsMjU1LDQsMTYsMCwwLDAsMCw0LDE2LDI0NSwxODAsMCwwLDIxLDE2LDMyLDAsMCwwLDQ5LDE2LDQ4LDAsMCwwLDUsMTYsMiwwLDAsMCwxNiwzMiwwLDAsMCwxNiwwLDQsMCwwLDE2LDIsMCwwLDAsOSwxNiwyLDAsMCwwLDE2LDgsMCwwLDAsMTYsMCw0LDAsMCwxNiwyLDAsMCwwLDksMTYsMCwwLDAsMCw0LDE2LDI0NSwxODAsMCwwLDIxLDE2LDIzMCw2LDAsMCwxNiwxLDAsMCwwLDgsMTYsMiwwLDAsMCwxNiwxMzAsMCwwLDAsMTYsMjQ3LDE4MCwwLDAsMjEsMzIsMTYsMCw0LDAsMCwxNiwyLDAsMCwwLDksMTYsMiwwLDAsMCwxNiw4LDAsMCwwLDE2LDAsNCwwLDAsMTYsMiwwLDAsMCw5LDE2LDI0NCwxODAsMCwwLDE2LDAsMCwwLDAsMjcsMTYsNzAsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNywxNiwwLDAsMCwwLDQ5LDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMSwwLDAsMCwxNywxNiwwLDAsMCwwLDQ5LDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsNywwLDAsMCwxNiwyNDgsMTgwLDAsMCwyMSw1MiwxNiwxOTgsMCwwLDAsMzQsNCwxNiwwLDAsMCwwLDE3LDE2LDI1NSwxLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDEsMCwwLDAsMTcsMTYsMzEsMSwwLDAsNTAsMTYsMTIsMCwwLDAsNSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwzLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsMCwyLDAsMCwxNiwxLDAsMCwwLDE3LDM0LDMyLDI1LDE2LDQsMCwwLDAsMTYsMSwwLDAsMCwxNiwzLDAsMCwwLDE3LDE2LDgsMCwwLDAsMzYsMzQsMjUsMTYsMywwLDAsMCwxNiwwLDE4NCwwLDAsMTYsMywwLDAsMCwxNywxNiw4LDAsMCwwLDM1LDMyLDI1LDE2LDMsMCwwLDAsMTcsMTYsMywwLDAsMCwxNywyMSwxNiw0LDAsMCwwLDE3LDE2LDcsMCwwLDAsMzMsNTUsMTYsMjU0LDI1NSwyNTUsMjU1LDUyLDE2LDIsMCwwLDAsMTcsMTYsMSwwLDAsMCw1Miw1NCwxNiw3LDAsMCwwLDE2LDQsMCwwLDAsMTcsMzMsNTUsMjksMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDE3LDE2LDI1NSwxLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDEsMCwwLDAsMTcsMTYsMTQzLDAsMCwwLDUwLDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMywwLDAsMCwxNiwwLDAsMCwwLDE3LDE2LDAsMiwwLDAsMTYsMSwwLDAsMCwxNywzNCwzMiwyNSwxNiw0LDAsMCwwLDE2LDIsMCwwLDAsMTYsMywwLDAsMCwxNywxNiw0LDAsMCwwLDM2LDM0LDI1LDE2LDMsMCwwLDAsMTYsMCwxODQsMCwwLDE2LDMsMCwwLDAsMTcsMTYsNCwwLDAsMCwzNSwzMiwyNSwxNiwzLDAsMCwwLDE3LDE2LDMsMCwwLDAsMTcsMjEsMTYsNCwwLDAsMCwxNywxNiw2LDAsMCwwLDMzLDU1LDE2LDI1MiwyNTUsMjU1LDI1NSw1MiwxNiwyLDAsMCwwLDE3LDE2LDMsMCwwLDAsNTIsNTQsMTYsNiwwLDAsMCwxNiw0LDAsMCwwLDE3LDMzLDU1LDI5LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCwxNywxNiwyNTUsMCwwLDAsNTAsMTYsMTIsMCwwLDAsNSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwxLDAsMCwwLDE3LDE2LDE0MywwLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDMsMCwwLDAsMTYsMCwwLDAsMCwxNywxNiwwLDEsMCwwLDE2LDEsMCwwLDAsMTcsMzQsMzIsMjUsMTYsNCwwLDAsMCwxNiw0LDAsMCwwLDE2LDMsMCwwLDAsMTcsMTYsMiwwLDAsMCwzNiwzNCwyNSwxNiwzLDAsMCwwLDE2LDAsMTg0LDAsMCwxNiwzLDAsMCwwLDE3LDE2LDIsMCwwLDAsMzUsMzIsMjUsMTYsMywwLDAsMCwxNywxNiwzLDAsMCwwLDE3LDIxLDE2LDQsMCwwLDAsMTcsMTYsNCwwLDAsMCwzMyw1NSwxNiwyNDAsMjU1LDI1NSwyNTUsNTIsMTYsMiwwLDAsMCwxNywxNiwxNSwwLDAsMCw1Miw1NCwxNiw0LDAsMCwwLDE2LDQsMCwwLDAsMTcsMzMsNTUsMjksMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDE3LDE2LDI1NSwwLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDEsMCwwLDAsMTcsMTYsNzEsMCwwLDAsNTAsMTYsMTIsMCwwLDAsNSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwzLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsMCwxLDAsMCwxNiwxLDAsMCwwLDE3LDM0LDMyLDI1LDE2LDQsMCwwLDAsMTYsOCwwLDAsMCwxNiwzLDAsMCwwLDE3LDE2LDEsMCwwLDAsMzYsMzQsMjUsMTYsMywwLDAsMCwxNiwwLDE4NCwwLDAsMTYsMywwLDAsMCwxNywxNiwxLDAsMCwwLDM1LDMyLDI1LDE2LDMsMCwwLDAsMTcsMTYsMywwLDAsMCwxNywyMSwxNiw0LDAsMCwwLDE3LDE2LDAsMCwwLDAsMzMsNTUsMTYsMCwyNTUsMjU1LDI1NSw1MiwxNiwyLDAsMCwwLDE3LDE2LDI1NSwwLDAsMCw1Miw1NCwxNiwwLDAsMCwwLDE2LDQsMCwwLDAsMTcsMzMsNTUsMjksMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDE3LDE2LDI1NSwxLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDEsMCwwLDAsMTcsMTYsMzEsMSwwLDAsNTAsMTYsMTIsMCwwLDAsNSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwzLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsMCwyLDAsMCwxNiwxLDAsMCwwLDE3LDM0LDMyLDI1LDE2LDQsMCwwLDAsMTYsMSwwLDAsMCwxNiwzLDAsMCwwLDE3LDE2LDgsMCwwLDAsMzYsMzQsMjUsMTYsMywwLDAsMCwxNiwwLDE4NCwwLDAsMTYsMywwLDAsMCwxNywxNiw4LDAsMCwwLDM1LDMyLDI1LDE2LDMsMCwwLDAsMTcsMTYsMywwLDAsMCwxNywyMSwxNiw0LDAsMCwwLDE3LDE2LDcsMCwwLDAsMzMsNTUsMTYsMjU0LDI1NSwyNTUsMjU1LDUyLDE2LDIsMCwwLDAsMTcsMTYsMSwwLDAsMCw1Miw1NCwxNiw3LDAsMCwwLDE2LDQsMCwwLDAsMTcsMzMsNTUsMjksMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDE3LDE2LDI1NSwwLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDEsMCwwLDAsMTcsMTYsMzEsMSwwLDAsNTAsMTYsMTIsMCwwLDAsNSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwzLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsMCwxLDAsMCwxNiwxLDAsMCwwLDE3LDM0LDMyLDI1LDE2LDQsMCwwLDAsMTYsMiwwLDAsMCwxNiwzLDAsMCwwLDE3LDE2LDQsMCwwLDAsMzYsMzQsMjUsMTYsMywwLDAsMCwxNiwwLDE4NCwwLDAsMTYsMywwLDAsMCwxNywxNiw0LDAsMCwwLDM1LDMyLDI1LDE2LDMsMCwwLDAsMTcsMTYsMywwLDAsMCwxNywyMSwxNiw0LDAsMCwwLDE3LDE2LDYsMCwwLDAsMzMsNTUsMTYsMjUyLDI1NSwyNTUsMjU1LDUyLDE2LDIsMCwwLDAsMTcsMTYsMywwLDAsMCw1Miw1NCwxNiw2LDAsMCwwLDE2LDQsMCwwLDAsMTcsMzMsNTUsMjksMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDE3LDE2LDI1NSwwLDAsMCw1MCwxNiwxMiwwLDAsMCw1LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCw0LDE2LDEsMCwwLDAsMTcsMTYsMTQzLDAsMCwwLDUwLDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMywwLDAsMCwxNiwwLDAsMCwwLDE3LDE2LDAsMSwwLDAsMTYsMSwwLDAsMCwxNywzNCwzMiwyNSwxNiw0LDAsMCwwLDE2LDQsMCwwLDAsMTYsMywwLDAsMCwxNywxNiwyLDAsMCwwLDM2LDM0LDI1LDE2LDMsMCwwLDAsMTYsMCwxODQsMCwwLDE2LDMsMCwwLDAsMTcsMTYsMiwwLDAsMCwzNSwzMiwyNSwxNiwzLDAsMCwwLDE3LDE2LDMsMCwwLDAsMTcsMjEsMTYsNCwwLDAsMCwxNywxNiw0LDAsMCwwLDMzLDU1LDE2LDI0MCwyNTUsMjU1LDI1NSw1MiwxNiwyLDAsMCwwLDE3LDE2LDE1LDAsMCwwLDUyLDU0LDE2LDQsMCwwLDAsMTYsNCwwLDAsMCwxNywzMyw1NSwyOSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsMTcsMTYsMTI3LDAsMCwwLDUwLDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMSwwLDAsMCwxNywxNiwxNDMsMCwwLDAsNTAsMTYsMTIsMCwwLDAsNSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwzLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsMTI4LDAsMCwwLDE2LDEsMCwwLDAsMTcsMzQsMzIsMjUsMTYsNCwwLDAsMCwxNiw4LDAsMCwwLDE2LDMsMCwwLDAsMTcsMTYsMSwwLDAsMCwzNiwzNCwyNSwxNiwzLDAsMCwwLDE2LDAsMTg0LDAsMCwxNiwzLDAsMCwwLDE3LDE2LDEsMCwwLDAsMzUsMzIsMjUsMTYsMywwLDAsMCwxNywxNiwzLDAsMCwwLDE3LDIxLDE2LDQsMCwwLDAsMTcsMTYsMCwwLDAsMCwzMyw1NSwxNiwwLDI1NSwyNTUsMjU1LDUyLDE2LDIsMCwwLDAsMTcsMTYsMjU1LDAsMCwwLDUyLDU0LDE2LDAsMCwwLDAsMTYsNCwwLDAsMCwxNywzMyw1NSwyOSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTcsMTYsOCwwLDAsMCw0OCwxNiwxMzAsMCwwLDAsNSwxNiwyNTIsMTc1LDAsMCwxNiwyNTIsMTc1LDAsMCwyMywxNiwxLDAsMCwwLDMzLDI5LDE2LDI1MiwxNzUsMCwwLDIzLDE2LDAsMCwwLDAsNDksMTYsODIsMCwwLDAsNSwxNiwyNTIsMTc1LDAsMCwxNiw1MCw1LDAsMCwxNiwwLDAsMCwwLDgsMTYsOCwwLDAsMCwzNSwyOSwxNiwyNTMsMTc1LDAsMCwxNiwyNTMsMTc1LDAsMCwyMywxNiwxLDAsMCwwLDMzLDI5LDE2LDI1MywxNzUsMCwwLDIzLDE2LDAsMCwwLDAsNDksMTYsMTcsMCwwLDAsNSwxNiwyNTIsMTc1LDAsMCwxNiwwLDAsMCwwLDI4LDE2LDAsMCwwLDAsNCwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxNywxNiw5LDAsMCwwLDQ4LDE2LDc4LDAsMCwwLDUsMTYsMjUyLDE3NSwwLDAsMTYsMjUyLDE3NSwwLDAsMjEsMTYsMSwwLDAsMCwzMiwyOSwxNiwyNTIsMTc1LDAsMCwyMSwxNiw4LDAsMCwwLDM2LDE2LDMwLDAsMCwwLDUsMTYsMjUyLDE3NSwwLDAsMTYsMjUyLDE3NSwwLDAsMjEsMTYsMSwwLDAsMCwzMiwyOSwxNiwyMTQsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxNywxNiwxMCwwLDAsMCw0OCwxNiw0MSwwLDAsMCw1LDE2LDI1MiwxNzUsMCwwLDE2LDAsMCwwLDAsMjksMTYsMjUzLDE3NSwwLDAsMTYsMjUzLDE3NSwwLDAsMjEsMTYsMSwwLDAsMCwzMiwyOSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwwLDAsMCwwLDE3LDE2LDEzLDAsMCwwLDQ4LDE2LDIzLDAsMCwwLDUsMTYsMjUyLDE3NSwwLDAsMTYsMCwwLDAsMCwyOSwxNiwwLDAsMCwwLDExLDE2LDAsMCwwLDAsNCwxNiwwLDAsMCwwLDE3LDE2LDMyLDAsMCwwLDQ5LDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMSwwLDAsMCwxNiwyNTIsMTc1LDAsMCwyMSwxNiw4LDAsMCwwLDM0LDI1LDE2LDEsMCwwLDAsMTcsMTYsMjIzLDMsMCwwLDE2LDAsMCwwLDAsOCw1MCwxNiw0NiwwLDAsMCw1LDE2LDI1MiwxNzUsMCwwLDE2LDAsMCwwLDAsMjksMTYsMjUzLDE3NSwwLDAsMTYsMjUzLDE3NSwwLDAsMjEsMTYsMSwwLDAsMCwzMiwyOSwxNiwxLDAsMCwwLDE2LDAsMCwwLDAsMjUsMTYsMCwwLDAsMCw0LDE2LDMsMCwwLDAsMTYsMSwwLDAsMCwxNywxNiw4LDAsMCwwLDMyLDI1LDE2LDIsMCwwLDAsMTYsMjUzLDE3NSwwLDAsMjEsMTYsOCwwLDAsMCwzNCwyNSwxNiwyLDAsMCwwLDE3LDE2LDIyNCwzLDAsMCwxNiwwLDAsMCwwLDgsNTAsMTYsNjYsMCwwLDAsNSwxNiwyNTMsMTc1LDAsMCwxNiwyNTMsMTc1LDAsMCwyMSwxNiwxLDAsMCwwLDMzLDI5LDE2LDIsMCwwLDAsMTYsMiwwLDAsMCwxNywxNiw4LDAsMCwwLDMzLDI1LDE2LDcsMCwwLDAsMTYsNywwLDAsMCwxNywxNiw4LDAsMCwwLDMyLDI1LDE2LDE3MiwyNTUsMjU1LDI1NSw0LDE2LDAsMCwwLDAsNCwxNiw3LDAsMCwwLDE3LDE2LDEwNywxLDAsMCwxNiwxLDAsMCwwLDgsMTYsNCwwLDAsMCwxNiwyLDAsMCwwLDE3LDE2LDgsMCwwLDAsMzIsMjUsMTYsNywwLDAsMCwxNiwwLDE3NiwwLDAsMTYsMCwwLDAsMCwxNywxNiwxMjcsMCwwLDAsNTIsMTYsOCwwLDAsMCwzNCwzMiwyNSwxNiw2LDAsMCwwLDE2LDIsMCwwLDAsMTcsMjUsMTYsNiwwLDAsMCwxNywxNiw0LDAsMCwwLDE3LDQ5LDE2LDE4OCwwLDAsMCw1LDE2LDgsMCwwLDAsMTYsNywwLDAsMCwxNywyMSwxNiwyNDgsMjU1LDI1NSwyNTUsNTUsMjUsMTYsNSwwLDAsMCwxNiwxLDAsMCwwLDE3LDI1LDE2LDUsMCwwLDAsMTcsMTYsMywwLDAsMCwxNyw0OSwxNiw5MCwwLDAsMCw1LDE2LDgsMCwwLDAsMTYsOCwwLDAsMCwxNywxNiwxLDAsMCwwLDU1LDI1LDE2LDUsMCwwLDAsMTcsMTYsNiwwLDAsMCwxNywxNiwyNTQsMTc1LDAsMCwxNiw4LDAsMCwwLDE3LDE2LDEsMCwwLDAsNTIsMzIsMjEsMTYsMzMsMjQ2LDI1NSwyNTUsMTYsMywwLDAsMCw4LDE2LDUsMCwwLDAsMTYsNSwwLDAsMCwxNywxNiwxLDAsMCwwLDMyLDI1LDE2LDE1MywyNTUsMjU1LDI1NSw0LDE2LDAsMCwwLDAsNCwxNiw3LDAsMCwwLDE2LDcsMCwwLDAsMTcsMTYsMSwwLDAsMCwzMiwyNSwxNiw2LDAsMCwwLDE2LDYsMCwwLDAsMTcsMTYsMSwwLDAsMCwzMiwyNSwxNiw1NSwyNTUsMjU1LDI1NSw0LDE2LDAsMCwwLDAsNCwxNiwyNTIsMTc1LDAsMCwxNiwyNTIsMTc1LDAsMCwyMSwxNiwxLDAsMCwwLDMyLDI5LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE3LDIxLDE2LDQ4LDAsMCwwLDUsMTYsMCwwLDAsMCwxNywyMSwxNiw0NywyNTIsMjU1LDI1NSwxNiwxLDAsMCwwLDgsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE3LDE2LDEsMCwwLDAsMzIsMjUsMTYsMjAxLDI1NSwyNTUsMjU1LDQsMTYsMCwwLDAsMCw0LDE2LDAsMCwwLDAsMTEsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE3LDUxLDE2LDEyLDAsMCwwLDUsMTYsMCwwLDAsMCwxMSwxNiwwLDAsMCwwLDQsMTYsMSwwLDAsMCwxNiwwLDE4NCwwLDAsMjUsMTYsMiwwLDAsMCwxNiwwLDAsMCwwLDE3LDE2LDU2LDIsMCwwLDE2LDAsMCwwLDAsOCwzNCwyNSwxNiwzLDAsMCwwLDE2LDAsMCwxLDAsMTYsMiwwLDAsMCwxNywzMywyNSwxNiwxLDAsMCwwLDE3LDE2LDMsMCwwLDAsMTcsNDksMTYsNTEsMCwwLDAsNSwxNiwxLDAsMCwwLDE3LDE2LDEsMCwwLDAsMTcsMTYsMiwwLDAsMCwxNywzMiwxOSwyNywxNiwxLDAsMCwwLDE2LDEsMCwwLDAsMTcsMTYsNCwwLDAsMCwzMiwyNSwxNiwxOTIsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMywwLDAsMCwxNiw5OSwxLDAsMCwxNiwwLDAsMCwwLDgsMjUsMTYsMCwwLDAsMCwxNiwyMzEsMCwwLDAsMTYsMCwwLDAsMCw4LDI1LDE2LDIsMCwwLDAsMTYsMzIsMCwwLDAsMjUsMTYsMiwwLDAsMCwxNywxNiw3NywwLDAsMCw1LDE2LDAsMCwwLDAsMTcsMTYsMywwLDAsMCwxNywxNiwyNTQsMTc1LDAsMCwyMSwxNiwxMTcsMjQ0LDI1NSwyNTUsMTYsMywwLDAsMCw4LDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNywxNiwxLDAsMCwwLDMzLDI1LDE2LDIsMCwwLDAsMTYsMiwwLDAsMCwxNywxNiwxLDAsMCwwLDMzLDI1LDE2LDE3MywyNTUsMjU1LDI1NSw0LDE2LDAsMCwwLDAsNCwxNiwxLDAsMCwwLDE3LDE2LDI1MiwyNTUsMCwwLDQ5LDE2LDQzLDAsMCwwLDUsMTYsMSwwLDAsMCwxNywxNiwyNTIsMjU1LDAsMCwxOSwyNywxNiwxLDAsMCwwLDE2LDEsMCwwLDAsMTcsMTYsNCwwLDAsMCwzMiwyNSwxNiwyMDEsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMCwwLDAsMCwxMSwxNiwzLDAsMCwwLDE2LDI0OCwxODAsMCwwLDIxLDUyLDE2LDExLDAsMCwwLDM0LDQsMTYsMSwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDMsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxNSwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDI1NSwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDcsMCwwLDAsMTYsMjQ4LDE4MCwwLDAsMjEsNTIsMTYsMTEsMCwwLDAsMzQsNCwxNiwyNTUsMSwwLDAsMTYsMSwwLDAsMCwxMSwxNiwyNTUsMSwwLDAsMTYsMSwwLDAsMCwxMSwxNiwyNTUsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwyNTUsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwyNTUsMSwwLDAsMTYsMSwwLDAsMCwxMSwxNiwyNTUsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwyNTUsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxMjcsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiw3LDAsMCwwLDE2LDI0OCwxODAsMCwwLDIxLDUyLDE2LDExLDAsMCwwLDM0LDQsMTYsMzEsMSwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxNDMsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxNDMsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiw3MSwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDMxLDEsMCwwLDE2LDEsMCwwLDAsMTEsMTYsMzEsMSwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxNDMsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxNDMsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiw3LDAsMCwwLDE2LDI0OCwxODAsMCwwLDIxLDUyLDE2LDExLDAsMCwwLDM0LDQsMTYsNjQsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxMjgsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwxMjgsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiwwLDEsMCwwLDE2LDEsMCwwLDAsMTEsMTYsNjQsMCwwLDAsMTYsMSwwLDAsMCwxMSwxNiw2NCwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDEyOCwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDEyOCwwLDAsMCwxNiwxLDAsMCwwLDExLDE2LDAsMCwwLDAsMTYsMCwwLDAsMCwxNiwwLDAsMCwwLDE2LDIsMCwwLDAsMTYsMSwwLDAsMCwyNSwxNiwxLDAsMCwwLDE3LDE2LDAsMCwwLDAsNTAsMTYsNDksMCwwLDAsNSwxNiwyLDAsMCwwLDE2LDIsMCwwLDAsMTcsMTYsMCwwLDAsMCwxNywzNCwyNSwxNiwxLDAsMCwwLDE2LDEsMCwwLDAsMTcsMTYsMSwwLDAsMCwzMywyNSwxNiwxOTUsMjU1LDI1NSwyNTUsNCwxNiwwLDAsMCwwLDQsMTYsMiwwLDAsMCwxNywxNiwxLDAsMCwwLDExLDE2LDgsMCwwLDAsMTMsMzIsMTYsMSwwLDAsMCwxMSw5LDMyLDQ3LDQ3LDQ3LDMyLDgwLDEwMSwxMTYsMTA1LDksOSw5LDksOCw4LDgsODAsMTAxLDExNiwxMDUsNDUsNTcsMzIsNDcsNDcsNDcsMTAsMTAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDAsMCwwLDEwLDgyLDEwMSw5NywxMDAsMTIxLDQ2LDEwLDAsMCwwLDAsMCwwLDAsMA=='
})()