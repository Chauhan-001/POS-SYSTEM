import { useEffect, useMemo, useRef } from 'react'

type Props = {
  className?: string
  /**
   * Matches Stitch pages where the canvas is extremely subtle.
   */
  opacity?: number
  enabled?: boolean
  /**
   * Stitch sometimes sets a static pattern background behind the shader.
   */
  backgroundImageUrl?: string
}

export default function ShaderBackgroundWebGL({
  className,
  opacity = 0.05,
  enabled = true,
  backgroundImageUrl,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const shaders = useMemo(() => {
    const vertex = `
      attribute vec2 position;
      varying vec2 v_texCoord;
      void main() {
        v_texCoord = position * 0.5 + 0.5;
        gl_Position = vec4(position, 0.0, 1.0);
      }
    `

    // Based on Stitch rewards_wallet_branded_patterns inline shader (mandala/grid).
    const fragment = `
      precision highp float;
      varying vec2 v_texCoord;
      uniform float u_time;
      uniform vec2 u_resolution;

      float mandala(vec2 uv, float time) {
        uv *= 2.0;
        float d = length(uv);
        float a = atan(uv.y, uv.x);
        float s = abs(cos(a * 8.0 + time * 0.2));
        float shape = smoothstep(0.4, 0.41, d / s);
        float ring1 = abs(sin(d * 15.0 - time * 0.5));
        float ring2 = abs(cos(d * 30.0 + a * 4.0));
        return shape * (ring1 * 0.5 + ring2 * 0.5);
      }

      void main() {
        vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.y, u_resolution.x);
        vec3 color1 = vec3(0.90, 0.0, 0.14); // #e60023
        vec3 color2 = vec3(1.0, 0.8, 0.1);  // Gold
        vec3 background = vec3(1.0, 0.97, 0.96);

        float m = mandala(uv * 0.5, u_time);
        vec2 grid_uv = fract(uv * 3.0) - 0.5;
        float small_m = mandala(grid_uv * 1.5, u_time * 0.5);

        vec3 finalColor = mix(background, color1, m * 0.05);
        finalColor = mix(finalColor, color2, small_m * 0.03);

        gl_FragColor = vec4(finalColor, 1.0);
      }
    `

    return { vertex, fragment }
  }, [])

  useEffect(() => {
    if (!enabled) return
    const canvas = canvasRef.current
    if (!canvas) return

    const gl = canvas.getContext('webgl')
    if (!gl) return

    let raf = 0
    let destroyed = false

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.floor(window.innerWidth * dpr)
      canvas.height = Math.floor(window.innerHeight * dpr)
      gl.viewport(0, 0, canvas.width, canvas.height)
    }
    resize()

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1])
    const buffer = gl.createBuffer()
    if (!buffer) return
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    const compile = (type: number, source: string) => {
      const shader = gl.createShader(type)
      if (!shader) return null
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      return shader
    }

    const vs = compile(gl.VERTEX_SHADER, shaders.vertex)
    const fs = compile(gl.FRAGMENT_SHADER, shaders.fragment)
    if (!vs || !fs) return

    const program = gl.createProgram()
    if (!program) return

    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.useProgram(program)

    const posLoc = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(posLoc)
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0)

    const timeLoc = gl.getUniformLocation(program, 'u_time')
    const resLoc = gl.getUniformLocation(program, 'u_resolution')

    const render = (time: number) => {
      if (destroyed) return
      gl.uniform1f(timeLoc, time * 0.001)
      gl.uniform2f(resLoc, canvas.width, canvas.height)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      raf = requestAnimationFrame(render)
    }

    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    raf = requestAnimationFrame(render)

    return () => {
      destroyed = true
      window.removeEventListener('resize', onResize)
      cancelAnimationFrame(raf)
    }
  }, [enabled, shaders])

  return (
    <canvas
      ref={canvasRef}
      id="patternCanvas"
      className={['fixed inset-0 w-full h-full pointer-events-none', className ?? ''].join(' ')}
      style={{
        zIndex: -1,
        opacity,
        backgroundImage: backgroundImageUrl ? `url("${backgroundImageUrl}")` : undefined,
        backgroundRepeat: backgroundImageUrl ? 'repeat' : undefined,
        backgroundSize: backgroundImageUrl ? '200px' : undefined,
      }}
      aria-hidden="true"
      tabIndex={-1}
    />
  )
}
