(function(){
    /////////////////////////////////
    // WebGL Boilerplate
    /////////////////////////////////
    function get_webgl_context(canvas_name, gl_type){
        const canvas = document.querySelector(canvas_name);
        const gl = canvas.getContext(gl_type);
        if (!gl){
            console.log("Couldn't get webgl context");
        }
        return gl;
    }

    function create_shader(gl, type, source){
        var shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        var success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        if (success){
            return shader;
        }

        console.log(gl.getShaderInfoLog(shader));
        gl.deleteShader(shader);
    }

    function create_program(gl, vertex_shader, fragment_shader){
        const program = gl.createProgram();
        gl.attachShader(program, vertex_shader);
        gl.attachShader(program, fragment_shader);
        gl.linkProgram(program);
        var success = gl.getProgramParameter(program, gl.LINK_STATUS);
        if (success){
            return program;
        }

        console.log(gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
    }

    function create_and_link_shaders(gl, vertex_shader_source, fragment_shader_source){
        const vertex_shader = create_shader(gl, gl.VERTEX_SHADER, vertex_shader_source);
        const fragment_shader = create_shader(gl, gl.FRAGMENT_SHADER, fragment_shader_source);
        const program = create_program(gl, vertex_shader, fragment_shader);
        return program;
    }
    
    const gl = get_webgl_context("#gameOfLifeCanvas", "webgl");
    const canvas = document.querySelector("#gameOfLifeCanvas");

})();
