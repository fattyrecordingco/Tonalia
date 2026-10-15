import type { Analysis, View } from '../types';
const vertex = `#version 300 es
void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.0-1.0,0.0,1.0);}`;
const fragment = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D u_levels;
uniform vec2 u_size;
uniform vec2 u_columns;
uniform vec2 u_frequency;
uniform vec2 u_range;
uniform float u_rate;
uniform int u_fft;
uniform int u_bins;
uniform int u_count;
uniform int u_channels;
uniform bool u_log;
out vec4 color;
vec3 palette(float v){
 vec3 stops[8]=vec3[8](vec3(8,13,24),vec3(27,31,65),vec3(60,44,99),vec3(114,60,114),vec3(178,91,102),vec3(225,140,101),vec3(249,209,139),vec3(255,248,218));
 float x=clamp(v,0.0,1.0)*7.0;int i=min(6,int(floor(x)));return mix(stops[i],stops[i+1],x-float(i))/255.0;
}
void main(){
 float y=(1.0-gl_FragCoord.y/u_size.y)*float(u_channels);
 int channel=min(u_channels-1,int(floor(y)));float fraction=1.0-fract(y);
 float hz=u_log?u_frequency.x*pow(u_frequency.y/u_frequency.x,fraction):mix(u_frequency.x,u_frequency.y,fraction);
 int bin=clamp(int(round(hz*float(u_fft)/u_rate)),0,u_bins-1);
 int col=int(round(u_columns.x+gl_FragCoord.x/u_size.x*u_columns.y));
 float db=(col>=0&&col<u_count)?texelFetch(u_levels,ivec2(bin,channel*u_count+col),0).r:-240.0;
 color=vec4(palette((db-u_range.x)/(u_range.y-u_range.x)),1.0);
}`;
/** GPU is display-only. Losing this context cannot alter processing or native playback. */
export class GpuSpectrogram {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private texture: WebGLTexture;
  private analysis: Analysis | null = null;
  constructor(canvas: HTMLCanvasElement, onLost: () => void) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const compile = (type: number, source: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(s) || 'Shader compilation failed');
      return s;
    };
    this.program = gl.createProgram()!;
    const v = compile(gl.VERTEX_SHADER, vertex),
      f = compile(gl.FRAGMENT_SHADER, fragment);
    gl.attachShader(this.program, v);
    gl.attachShader(this.program, f);
    gl.linkProgram(this.program);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error('Spectral display shader could not link.');
    this.texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      onLost();
    });
  }
  draw(a: Analysis, view: View, width: number, height: number, floor: number, ceiling: number) {
    const gl = this.gl,
      canvas = gl.canvas as HTMLCanvasElement;
    if (gl.isContextLost()) throw new Error('GPU context lost');
    const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (a.bins > limit || a.columns * a.channels > limit)
      throw new Error('Analysis exceeds GPU texture limit');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    if (this.analysis !== a) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.R32F,
        a.bins,
        a.columns * a.channels,
        0,
        gl.RED,
        gl.FLOAT,
        a.levels,
      );
      this.analysis = a;
    }
    const u = (name: string) => gl.getUniformLocation(this.program, name);
    gl.uniform1i(u('u_levels'), 0);
    gl.uniform2f(u('u_size'), canvas.width, canvas.height);
    gl.uniform2f(u('u_columns'), (view.start - a.start) / a.hop, (view.end - view.start) / a.hop);
    gl.uniform2f(u('u_frequency'), view.low, view.high);
    gl.uniform2f(u('u_range'), floor, ceiling);
    gl.uniform1f(u('u_rate'), a.sampleRate);
    gl.uniform1i(u('u_fft'), a.fftSize);
    gl.uniform1i(u('u_bins'), a.bins);
    gl.uniform1i(u('u_count'), a.columns);
    gl.uniform1i(u('u_channels'), a.channels);
    gl.uniform1i(u('u_log'), view.log ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (gl.getError() !== gl.NO_ERROR) throw new Error('GPU display failed');
  }
  dispose() {
    this.gl.deleteTexture(this.texture);
    this.gl.deleteProgram(this.program);
  }
}
